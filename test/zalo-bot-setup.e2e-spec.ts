import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { ZaloAlertsService } from '../src/modules/zalo-alerts/zalo-alerts.service';
import { ZaloBotService } from '../src/modules/zalo-alerts/zalo-bot.service';
import { ChatDigestService } from '../src/modules/zalo-alerts/chat-digest.service';
import { requireIsolatedDatabase } from './isolated-database';

describe('Bot connection and delayed Zalo channel in isolated PostgreSQL', () => {
  let db: DataSource, alerts: ZaloAlertsService, bot: ZaloBotService, digest: ChatDigestService;
  const values = new Map([
    ['ZALO_BOT_TOKEN', 'test-only'],
    ['ZALO_WEBHOOK_SECRET', 'test-secret'],
    ['QUEUE_SERVICE_URL', 'https://queue.test'],
    ['QUEUE_API_KEY', 'test-only'],
  ]);
  const config = { get: (key: string) => values.get(key) } as ConfigService;
  const message = (
    command: string,
    chatId = 'paired-admin',
    chatType = 'PRIVATE',
  ): Parameters<ZaloBotService['receive']>[1] => ({
    ok: true,
    result: {
      event_name: 'message.text.received',
      message: {
        from: { id: 'sender', is_bot: false },
        chat: { id: chatId, chat_type: chatType },
        text: command,
        message_id: randomUUID(),
      },
    },
  });
  beforeAll(async () => {
    requireIsolatedDatabase();
    db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
    alerts = new ZaloAlertsService(db, config);
    bot = new ZaloBotService(db, config, alerts);
    digest = new ChatDigestService(db, config, alerts);
  });
  beforeEach(async () => {
    await db.query(
      "DELETE FROM app_metadata WHERE key LIKE 'mocmaria.zalo.%' OR key LIKE 'mocmaria.chat.digest.%'",
    );
  });
  afterAll(async () => {
    await db.query(
      "DELETE FROM app_metadata WHERE key LIKE 'mocmaria.zalo.%' OR key LIKE 'mocmaria.chat.digest.%'",
    );
    await db.destroy();
  });
  it('consumes a pairing code once under concurrent delivery and immediately enables durable notifications', async () => {
    const pair = await bot.createPairing();
    await Promise.all([
      bot.receive('test-secret', message(pair.command)),
      bot.receive('test-secret', message(pair.command)),
    ]);
    expect(await alerts.configuredRecipients()).toEqual(['paired-admin']);
    expect(
      await db.query("SELECT key FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%'"),
    ).toHaveLength(1);
    await db.transaction((m) =>
      alerts.enqueue(m, {
        kind: 'inquiry',
        eventId: randomUUID(),
        customerName: 'QA',
        providerName: 'QA KTV',
      }),
    );
    expect(
      await db.query("SELECT key FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%'"),
    ).toHaveLength(2);
    await bot.receive('test-secret', message(pair.command, 'other-admin'));
    expect(await alerts.configuredRecipients()).toEqual(['paired-admin']);
  });
  it('rejects expired and wrong codes and permits a fresh owner-issued group connection', async () => {
    const expired = await bot.createPairing();
    await db.query(
      "UPDATE app_metadata SET value=value||jsonb_build_object('expiresAt',clock_timestamp()-interval '1 second') WHERE key='mocmaria.zalo.pairing'",
    );
    await bot.receive('test-secret', message(expired.command));
    expect(await alerts.configuredRecipients()).toEqual([]);
    const fresh = await bot.createPairing();
    await bot.receive('test-secret', message('Kết nối Mộc Maria 0000000000000000'));
    expect(await alerts.configuredRecipients()).toEqual([]);
    await bot.receive('test-secret', message(fresh.command, 'group-admin', 'GROUP'));
    expect(await alerts.configuredRecipients()).toEqual(['group-admin']);
  });
  it('accepts a bare webhook event with omitted optional is_bot metadata', async () => {
    const pair = await bot.createPairing();
    const update = message(pair.command, 'bare-admin').result!;
    delete update.message!.from!.is_bot;
    await bot.receive('test-secret', update);
    expect(await alerts.configuredRecipients()).toEqual(['bare-admin']);
    const [state] = await db.query<{ value: { eventName: string } }[]>(
      "SELECT value FROM app_metadata WHERE key='mocmaria.zalo.webhook.state'",
    );
    expect(state.value.eventName).toBe('message.text.received');
  });
  it('does not lose the Zalo report when email collected the thread before Bot connection', async () => {
    const [customer] = await db.query<{ id: string }[]>(
      `INSERT INTO users(email,display_name,password_hash) VALUES($1,'Bot QA customer','not-a-password') RETURNING id`,
      ['bot-c-' + randomUUID() + '@mocmaria.test'],
    );
    const [provider] = await db.query<{ id: string }[]>(
      `INSERT INTO users(email,display_name,password_hash) VALUES($1,'Bot QA provider','not-a-password') RETURNING id`,
      ['bot-p-' + randomUUID() + '@mocmaria.test'],
    );
    const [application] = await db.query<{ id: string }[]>(
      `INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,'Bot QA KTV','APPROVED') RETURNING id`,
      [provider.id],
    );
    const [thread] = await db.query<{ id: string }[]>(
      `INSERT INTO ktv_chat_threads(customer_user_id,provider_user_id,provider_application_id) VALUES($1,$2,$3) RETURNING id`,
      [customer.id, provider.id, application.id],
    );
    await db.query(
      `INSERT INTO admin_alert_recipients(email,enabled) VALUES('bot-qa@mocmaria.test',true) ON CONFLICT(email) DO UPDATE SET enabled=true`,
    );
    await db.query(
      `INSERT INTO ktv_chat_messages(thread_id,sender_user_id,client_message_id,body) VALUES($1,$2,gen_random_uuid(),'private QA body')`,
      [thread.id, customer.id],
    );
    await digest.saveSettings({
      enabled: true,
      mode: 'interval',
      hour: 9,
      intervalHours: 1,
      zalo: true,
      email: true,
    });
    const due = (): Promise<unknown[]> =>
      db.query(
        "UPDATE app_metadata SET value=jsonb_build_object('nextAt',clock_timestamp()-interval '1 second') WHERE key='mocmaria.chat.digest.state'",
      );
    await digest.runNow();
    expect(
      await db.query('SELECT key FROM app_metadata WHERE key=$1', [
        'mocmaria.chat.digest.watermark.' + thread.id,
      ]),
    ).toHaveLength(1);
    const pair = await bot.createPairing();
    await bot.receive('test-secret', message(pair.command));
    await digest.runNow();
    const reports = (): Promise<{ value: unknown }[]> =>
      db.query(
        `SELECT value FROM app_metadata WHERE key LIKE 'mocmaria.zalo.outbox.%' AND value->>'text' LIKE $1`,
        ['%' + thread.id + '%'],
      );
    expect(await reports()).toHaveLength(1);
    await due();
    await digest.collect();
    expect(await reports()).toHaveLength(1);
    expect(JSON.stringify(await reports())).not.toContain('private QA body');
    await db.query("DELETE FROM admin_alert_recipients WHERE email='bot-qa@mocmaria.test'");
  });
});
