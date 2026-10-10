import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { alertText, ZaloAlertsService, ZaloAlert } from './zalo-alerts.service';

const event: ZaloAlert = {
  kind: 'chat',
  eventId: 'message-1',
  customerName: 'Khách',
  providerName: 'KTV',
};
describe('Zalo durable notifications', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  function setup(configured = true): {
    service: ZaloAlertsService;
    query: jest.Mock<Promise<unknown[]>, [string, string[]]>;
    manager: EntityManager;
  } {
    const values = new Map(
      configured
        ? [
            ['ZALO_BOT_TOKEN', 'private-test'],
            ['ZALO_ADMIN_CHAT_IDS', 'admin-1,admin-1,invalid/id'],
          ]
        : [],
    );
    const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
    const config = { get: (key: string) => values.get(key) } as ConfigService;
    const service = new ZaloAlertsService({ query } as unknown as DataSource, config);
    return { service, query, manager: { query } as unknown as EntityManager };
  }
  it('keeps message bodies, addresses and credentials out of notification text', () => {
    expect(alertText(event)).toContain('Khách: Khách');
    expect(alertText(event)).not.toContain('private-test');
    expect(alertText({ ...event, providerName: 'KTV\nFake: alert' })).toContain(
      'KTV: KTV Fake: alert',
    );
  });
  it('disabled configuration does not contact database or external service', async () => {
    const { service, query, manager } = setup(false);
    global.fetch = jest.fn();
    await service.enqueue(manager, event);
    await service.drain();
    expect(query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('persists one deterministic event per valid distinct recipient without network', async () => {
    const { service, query, manager } = setup();
    global.fetch = jest.fn();
    await service.enqueue(manager, event);
    await service.enqueue(manager, event);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][0]).toBe(query.mock.calls[1][1][0]);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT(key) DO NOTHING');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'requires both HTTP and Zalo success (HTTP success=%s)',
    async (httpOk) => {
      const { service, query } = setup();
      query
        .mockResolvedValueOnce([
          { key: 'outbox', value: { recipient: 'admin-1', text: 'notification', attempts: 0 } },
        ])
        .mockResolvedValue([]);
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: httpOk, json: () => Promise.resolve({ ok: false }) });
      await service.drain();
      const saved = JSON.parse(query.mock.calls[1][1][1]) as { status: string; attempts: number };
      expect(saved.status).toBe('pending');
      expect(saved.attempts).toBe(1);
    },
  );
  it('retains retry state when transport fails and does not propagate the secret URL', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([
        { key: 'outbox', value: { recipient: 'admin-1', text: 'notification', attempts: 11 } },
      ])
      .mockResolvedValue([]);
    global.fetch = jest.fn().mockRejectedValue(new Error('private-test'));
    await expect(service.drain()).resolves.toBeUndefined();
    expect(JSON.parse(query.mock.calls[1][1][1])).toMatchObject({ status: 'failed', attempts: 12 });
  });
  it('marks a successful delivery sent and verifies lease ownership at finalization', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([
        { key: 'outbox', value: { recipient: 'admin-1', text: 'notification', attempts: 0 } },
      ])
      .mockResolvedValue([]);
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await service.drain();
    expect(JSON.parse(query.mock.calls[1][1][1])).toMatchObject({ status: 'sent', attempts: 1 });
    expect(query.mock.calls[1][0]).toContain("value->>'lease'=$3");
  });
});
