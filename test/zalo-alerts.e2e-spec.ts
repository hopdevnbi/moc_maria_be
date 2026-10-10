import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { ZaloAlertsService } from '../src/modules/zalo-alerts/zalo-alerts.service';
import { requireIsolatedDatabase } from './isolated-database';

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
