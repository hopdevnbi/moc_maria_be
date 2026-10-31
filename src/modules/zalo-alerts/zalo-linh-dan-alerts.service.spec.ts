import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ZaloAlertsService } from './zalo-alerts.service';
import { ZaloLinhDanAlertsService, linhDanOutboxPrefix } from './zalo-linh-dan-alerts.service';

describe('Second Zalo bot for booking requests', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function setup(enabled = true): {
    query: jest.Mock<Promise<unknown[]>, [string, string[]]>;
    secondary: ZaloLinhDanAlertsService;
    primary: ZaloAlertsService;
    manager: EntityManager;
  } {
    const vars = new Map<string, string>(
      enabled
        ? [
            ['ZALO_LINH_DAN_BOT_TOKEN', 'second-bot-test'],
            ['ZALO_LINH_DAN_CHAT_IDS', 'linh-dan-1,linh-dan-1,bad/id'],
            ['NODE_ENV', 'test'],
          ]
        : [['NODE_ENV', 'test']],
    );
    const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
    const config = { get: (key: string) => vars.get(key) } as ConfigService;
    const db = { query } as unknown as DataSource;
    const secondary = new ZaloLinhDanAlertsService(db, config);
    const primary = new ZaloAlertsService(db, config, secondary);
    return { query, secondary, primary, manager: { query } as unknown as EntityManager };
  }

  const inquiry = {
    kind: 'inquiry' as const,
    eventId: 'booking-1',
    customerName: 'Khách',
    providerName: 'KTV',
    serviceName: 'Chăm sóc',
  };

  it('does nothing when the new bot has no token and never uses primary recipients', async () => {
    const { primary, secondary, query, manager } = setup(false);
    global.fetch = jest.fn();
    await primary.enqueue(manager, inquiry);
    await secondary.drain();
    expect(query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('queues only booking inquiries with independent, deterministic keys', async () => {
    const { primary, query, manager } = setup();
    await primary.enqueue(manager, { ...inquiry, kind: 'chat' });
    expect(query).not.toHaveBeenCalled();
    await primary.enqueue(manager, inquiry);
    await primary.enqueue(manager, inquiry);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][0]).toBe(query.mock.calls[1][1][0]);
    expect(query.mock.calls[0][1][0]).toContain(linhDanOutboxPrefix);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT(key) DO NOTHING');
    expect(JSON.parse(query.mock.calls[0][1][1])).toMatchObject({
      recipient: 'linh-dan-1',
      status: 'pending',
    });
  });

  it('fans out to both bots with separate outbox keys when both are configured', async () => {
    const { query, manager } = setup();
    const configWithPrimary = {
      get: (key: string): string | undefined =>
        key === 'ZALO_BOT_TOKEN' ? 'primary-bot-test' : undefined,
    } as ConfigService;
    const both = new ZaloAlertsService(
      { query } as unknown as DataSource,
      configWithPrimary,
      new ZaloLinhDanAlertsService(
        { query } as unknown as DataSource,
        {
          get: (key: string): string | undefined =>
            key === 'ZALO_LINH_DAN_BOT_TOKEN'
              ? 'secondary-bot-test'
              : key === 'ZALO_LINH_DAN_CHAT_IDS'
                ? 'linh-dan-1'
                : undefined,
        } as ConfigService,
      ),
    );
    jest.spyOn(both, 'configuredRecipients').mockResolvedValue(['original-recipient']);
    await both.enqueue(manager, inquiry);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][0]).toContain('mocmaria.zalo.outbox.');
    expect(query.mock.calls[1][1][0]).toContain(linhDanOutboxPrefix);
  });

  it('does not affect the old bot and delivers only from the isolated outbox', async () => {
    const { secondary, query } = setup();
    query
      .mockResolvedValueOnce([
        {
          key: linhDanOutboxPrefix + 'test-key',
          value: { recipient: 'linh-dan-1', text: 'Booking request', attempts: 0 },
        },
      ])
      .mockResolvedValue([]);
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await secondary.drain();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('second-bot-test/sendMessage'),
      expect.objectContaining({
        body: JSON.stringify({ chat_id: 'linh-dan-1', text: 'Booking request' }),
      }),
    );
    expect(query.mock.calls[0][1][0]).toBe(linhDanOutboxPrefix + '%');
    expect(JSON.parse(query.mock.calls[1][1][1])).toMatchObject({
      status: 'sent',
      attempts: 1,
    });
  });

  it('preserves retries and never throws a token-bearing network error', async () => {
    const { secondary, query } = setup();
    query
      .mockResolvedValueOnce([
        {
          key: linhDanOutboxPrefix + 'test-key',
          value: { recipient: 'linh-dan-1', text: 'Booking request', attempts: 11 },
        },
      ])
      .mockResolvedValue([]);
    global.fetch = jest.fn().mockRejectedValue(new Error('second-bot-test'));
    await expect(secondary.drain()).resolves.toBeUndefined();
    expect(JSON.parse(query.mock.calls[1][1][1])).toMatchObject({
      status: 'failed',
      attempts: 12,
    });
  });
});
