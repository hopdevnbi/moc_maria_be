import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { ZaloAlertsService } from '../src/modules/zalo-alerts/zalo-alerts.service';
import { requireIsolatedDatabase } from './isolated-database';
import { randomUUID } from 'node:crypto';
import { ChatDigestService } from '../src/modules/zalo-alerts/chat-digest.service';

describe('Zalo outbox in disposable PostgreSQL', () => {
  let db: DataSource, service: ZaloAlertsService;
  const originalFetch = global.fetch;
  const event = {
    kind: 'chat' as const,
    eventId: 'isolated-message',
    customerName: 'QA',
    providerName: 'QA KTV',
  };
  beforeAll(async () => {
    requireIsolatedDatabase();
    db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
    service = new ZaloAlertsService(db, {
      get: (key: string) =>
        key === 'ZALO_BOT_TOKEN'
          ? 'test-only'
          : key === 'ZALO_ADMIN_CHAT_IDS'
            ? 'isolated-admin'
            : undefined,
    } as ConfigService);
  });
  beforeEach(async () => {
    await db.query("DELETE FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%'");
  });
  afterAll(async () => {
    global.fetch = originalFetch;
    await db.destroy();
  });
  it('rollback discards the alert; committed duplicate events keep one row', async () => {
    await expect(
      db.transaction(async (m) => {
        await service.enqueue(m, event);
        throw Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(
      await db.query("SELECT key FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%'"),
    ).toHaveLength(0);
    await db.transaction(async (m) => {
      await service.enqueue(m, event);
      await service.enqueue(m, event);
    });
    expect(
      await db.query("SELECT key FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%'"),
    ).toHaveLength(1);
  });
  it('two workers deliver a committed event once and sent events are not resent', async () => {
    await db.transaction((m) => service.enqueue(m, event));
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const second = new ZaloAlertsService(db, {
      get: (key: string) =>
        key === 'ZALO_BOT_TOKEN'
          ? 'test-only'
          : key === 'ZALO_ADMIN_CHAT_IDS'
            ? 'isolated-admin'
            : undefined,
    } as ConfigService);
    await Promise.all([service.drain(), second.drain()]);
    await service.drain();
    expect(fetch).toHaveBeenCalledTimes(1);
    const rows = await db.query<{ status: string }[]>(
      "SELECT value->>'status' AS status FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%'",
    );
    expect(rows[0].status).toBe('sent');
  });
  it('failed sends survive restart; backoff prevents an immediate retry', async () => {
    await db.transaction((m) => service.enqueue(m, event));
    global.fetch = jest.fn().mockRejectedValue(Error('network'));
    await service.drain();
    await service.drain();
    expect(fetch).toHaveBeenCalledTimes(1);
    await db.query(
      "UPDATE app_metadata SET value=value||jsonb_build_object('nextAt',clock_timestamp()-interval '1 second') WHERE key LIKE 'mocmaria.zalo.outbox.%'",
    );
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await service.drain();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Scheduled thread digest in disposable PostgreSQL', () => {
  let db: DataSource, digest: ChatDigestService, zalo: ZaloAlertsService;
  let threadId: string, customerId: string, providerId: string;
  const originalFetch = global.fetch;
  const values = new Map<string, string>([
    ['ZALO_BOT_TOKEN', 'test-only'],
    ['ZALO_ADMIN_CHAT_IDS', 'isolated-admin'],
    ['QUEUE_SERVICE_URL', 'https://queue.test'],
    ['QUEUE_API_KEY', 'test-only-queue-key'],
  ]);
  const config = { get: (key: string) => values.get(key) } as ConfigService;
  const settings = {
    enabled: true,
    mode: 'interval' as const,
    hour: 9,
    intervalHours: 1,
    zalo: true,
    email: true,
  };
  const due = async (): Promise<unknown[]> =>
    db.query<unknown[]>(
      `UPDATE app_metadata SET value=jsonb_build_object('nextAt',clock_timestamp()-interval '1 second') WHERE key='mocmaria.chat.digest.state'`,
    );
  const deliveries = async (): Promise<
    { key: string; value: { text: string; status: string } }[]
  > =>
    db.query<{ key: string; value: { text: string; status: string } }[]>(
      `SELECT key,value FROM app_metadata WHERE (key LIKE 'mocmaria.chat.digest.email.%' OR key LIKE 'mocmaria.zalo.outbox.%')
        AND value->>'recipient' IN ('isolated-admin','digest-admin@mocmaria.test') AND value->>'text' LIKE $1`,
      ['%' + threadId + '%'],
    );
  beforeAll(async () => {
    requireIsolatedDatabase();
    db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
    zalo = new ZaloAlertsService(db, config);
    digest = new ChatDigestService(db, config, zalo);
    const [customer] = await db.query<{ id: string }[]>(
      `INSERT INTO users(email,display_name,password_hash) VALUES($1,'Digest customer','unused-test-hash') RETURNING id`,
      [`digest-${randomUUID()}@mocmaria.test`],
    );
    const [provider] = await db.query<{ id: string }[]>(
      `INSERT INTO users(email,display_name,password_hash) VALUES($1,'Digest provider','unused-test-hash') RETURNING id`,
      [`digest-${randomUUID()}@mocmaria.test`],
    );
    customerId = customer.id;
    providerId = provider.id;
    const [application] = await db.query<{ id: string }[]>(
      `INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,'Digest KTV','APPROVED') RETURNING id`,
      [providerId],
    );
    const [thread] = await db.query<{ id: string }[]>(
      `INSERT INTO ktv_chat_threads(customer_user_id,provider_user_id,provider_application_id) VALUES($1,$2,$3) RETURNING id`,
      [customerId, providerId, application.id],
    );
    threadId = thread.id;
    await db.query(
      `INSERT INTO admin_alert_recipients(email,enabled) VALUES('digest-admin@mocmaria.test',true) ON CONFLICT(email) DO UPDATE SET enabled=true`,
    );
  });
  beforeEach(async () => {
    values.set('ZALO_ADMIN_CHAT_IDS', 'isolated-admin');
    values.set('QUEUE_API_KEY', 'test-only-queue-key');
    await db.query(
      "DELETE FROM app_metadata WHERE key LIKE 'mocmaria.chat.digest.%' OR key LIKE 'mocmaria.zalo.outbox.%'",
    );
    await db.query('DELETE FROM ktv_chat_messages WHERE thread_id=$1', [threadId]);
    await digest.saveSettings(settings);
    await db.query(
      `INSERT INTO ktv_chat_messages(thread_id,sender_user_id,client_message_id,body) VALUES($1,$2,gen_random_uuid(),'private body'),($1,$2,gen_random_uuid(),'private body 2'),($1,$3,gen_random_uuid(),'private KTV reply')`,
      [threadId, customerId, providerId],
    );
    global.fetch = jest.fn();
  });
  afterAll(async () => {
    global.fetch = originalFetch;
    await db.destroy();
  });
  it('waits for the due time, groups both sides into one report per channel and survives concurrent workers', async () => {
    await digest.collect();
    expect(await deliveries()).toHaveLength(0);
    await due();
    const second = new ChatDigestService(db, config, zalo);
    await Promise.all([digest.collect(), second.collect()]);
    const rows = await deliveries();
    expect(rows).toHaveLength(2);
    expect(rows[0].value.text).toContain('Tin mới từ khách: 2');
    expect(rows[0].value.text).toContain('Tin mới từ KTV: 1');
    expect(rows[0].value.text).not.toContain('private body');
    expect(fetch).not.toHaveBeenCalled();
    await due();
    await digest.collect();
    expect(await deliveries()).toHaveLength(2);
    await db.query(
      `INSERT INTO ktv_chat_messages(thread_id,sender_user_id,client_message_id,body) VALUES($1,$2,gen_random_uuid(),'new body')`,
      [threadId, customerId],
    );
    await due();
    await digest.collect();
    expect(await deliveries()).toHaveLength(4);
  });
  it('does not advance the cursor when disabled or no delivery channel is configured', async () => {
    await digest.saveSettings({ ...settings, enabled: false });
    await due();
    await digest.collect();
    expect(await deliveries()).toHaveLength(0);
    await digest.saveSettings(settings);
    values.set('ZALO_ADMIN_CHAT_IDS', '');
    values.set('QUEUE_API_KEY', '');
    await due();
    await digest.collect();
    expect(
      await db.query('SELECT key FROM app_metadata WHERE key=$1', [
        'mocmaria.chat.digest.watermark.' + threadId,
      ]),
    ).toHaveLength(0);
    values.set('ZALO_ADMIN_CHAT_IDS', 'isolated-admin');
    values.set('QUEUE_API_KEY', 'test-only-queue-key');
    await digest.collect();
    expect(await deliveries()).toHaveLength(2);
  });
  it('email transport errors retry with the same Queue job id and concurrent drains claim once', async () => {
    await due();
    await digest.collect();
    global.fetch = jest.fn().mockRejectedValue(Error('network'));
    await digest.drainEmail();
    const own = (await deliveries()).find((row) => row.key.includes('.email.'))!;
    expect(own.value.status).toBe('pending');
    await db.query(
      `UPDATE app_metadata SET value=value||jsonb_build_object('nextAt',clock_timestamp()-interval '1 second') WHERE key=$1`,
      [own.key],
    );
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await Promise.all([digest.drainEmail(), new ChatDigestService(db, config, zalo).drainEmail()]);
    const requests = (fetch as jest.Mock).mock.calls.filter(
      (call: [string, RequestInit]) =>
        (JSON.parse(call[1].body as string) as { options: { jobId: string } }).options.jobId ===
        own.key,
    );
    expect(requests).toHaveLength(1);
    expect((await deliveries()).find((row) => row.key === own.key)?.value.status).toBe('queued');
    await db.query(
      `UPDATE app_metadata SET value=value||jsonb_build_object('nextAt',clock_timestamp()-interval '1 second') WHERE key=$1`,
      [own.key],
    );
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'completed' }) });
    await digest.drainEmail();
    expect((await deliveries()).find((row) => row.key === own.key)?.value.status).toBe('sent');
  });
});
