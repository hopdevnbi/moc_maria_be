import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ZaloAlertsService } from './zalo-alerts.service';
import { ZaloHoanAlertsService, hoanOutboxPrefix } from './zalo-hoan-alerts.service';
import { ZaloLinhDanAlertsService, linhDanOutboxPrefix } from './zalo-linh-dan-alerts.service';

describe('Third Zalo bot for booking requests', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function setup(enabled = true): {
    query: jest.Mock<Promise<unknown[]>, [string, string[]]>;
    secondary: ZaloHoanAlertsService;
    primary: ZaloAlertsService;
    manager: EntityManager;
  } {
    const vars = new Map<string, string>(
      enabled
        ? [
            ['ZALO_HOAN_BOT_TOKEN', 'third-bot-test'],
            ['ZALO_HOAN_CHAT_IDS', 'hoan-1,hoan-1,bad/id'],
            ['NODE_ENV', 'test'],
          ]
        : [['NODE_ENV', 'test']],
    );
    const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
    const config = { get: (key: string) => vars.get(key) } as ConfigService;
    const db = { query } as unknown as DataSource;
    const secondary = new ZaloHoanAlertsService(db, config);
    const primary = new ZaloAlertsService(db, config, undefined, secondary);
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

  it('queues chat and inquiries with independent, deterministic keys', async () => {
    const { primary, query, manager } = setup();
    await primary.enqueue(manager, { ...inquiry, kind: 'chat' });
    await primary.enqueue(manager, inquiry);
    await primary.enqueue(manager, inquiry);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][1][0]).not.toBe(query.mock.calls[1][1][0]);
    expect(query.mock.calls[1][1][0]).toBe(query.mock.calls[2][1][0]);
    expect(query.mock.calls[0][1][0]).toContain(hoanOutboxPrefix);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT(key) DO NOTHING');
    expect(JSON.parse(query.mock.calls[0][1][1])).toMatchObject({
      recipient: 'hoan-1',
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
      undefined,
      new ZaloHoanAlertsService(
        { query } as unknown as DataSource,
        {
          get: (key: string): string | undefined =>
            key === 'ZALO_HOAN_BOT_TOKEN'
              ? 'third-bot-test'
              : key === 'ZALO_HOAN_CHAT_IDS'
                ? 'hoan-1'
                : undefined,
        } as ConfigService,
      ),
    );
    jest.spyOn(both, 'configuredRecipients').mockResolvedValue(['original-recipient']);
    await both.enqueue(manager, inquiry);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][0]).toContain('mocmaria.zalo.outbox.');
    expect(query.mock.calls[1][1][0]).toContain(hoanOutboxPrefix);
  });

  it('fans out to three isolated bot outboxes', async () => {
    const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
    const vars = new Map<string, string>([
      ['ZALO_BOT_TOKEN', 'original-test-token'],
      ['ZALO_ADMIN_CHAT_IDS', 'original-1'],
      ['ZALO_LINH_DAN_BOT_TOKEN', 'linh-dan-test-token'],
      ['ZALO_LINH_DAN_CHAT_IDS', 'linh-dan-1'],
      ['ZALO_HOAN_BOT_TOKEN', 'hoan-test-token'],
      ['ZALO_HOAN_CHAT_IDS', 'hoan-1'],
    ]);
    const config = { get: (key: string): string | undefined => vars.get(key) } as ConfigService;
    const db = { query } as unknown as DataSource;
    const primary = new ZaloAlertsService(
      db,
      config,
      new ZaloLinhDanAlertsService(db, config),
      new ZaloHoanAlertsService(db, config),
    );
    jest.spyOn(primary, 'configuredRecipients').mockResolvedValue(['original-1']);
    await primary.enqueue({ query } as unknown as EntityManager, inquiry);
    expect(query).toHaveBeenCalledTimes(3);
    const keys = query.mock.calls.map((call) => call[1][0]);
    expect(keys[0]).toContain('mocmaria.zalo.outbox.');
    expect(keys[1]).toContain(linhDanOutboxPrefix);
    expect(keys[2]).toContain(hoanOutboxPrefix);
    const recipients = query.mock.calls.map((call) => {
      const payload = JSON.parse(call[1][1]) as { recipient: string };
      return payload.recipient;
    });
    expect(recipients).toEqual(['original-1', 'linh-dan-1', 'hoan-1']);
  });
  it('fans out a chat event to three bots with distinct idempotent outbox keys', async () => {
    const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
    const values = new Map([
      ['ZALO_BOT_TOKEN', 'original-token'],
      ['ZALO_LINH_DAN_BOT_TOKEN', 'linh-dan-token'],
      ['ZALO_LINH_DAN_CHAT_IDS', 'linh-dan-1'],
      ['ZALO_HOAN_BOT_TOKEN', 'hoan-token'],
      ['ZALO_HOAN_CHAT_IDS', 'hoan-1'],
    ]);
    const config = { get: (key: string): string | undefined => values.get(key) } as ConfigService;
    const db = { query } as unknown as DataSource;
    const primary = new ZaloAlertsService(
      db,
      config,
      new ZaloLinhDanAlertsService(db, config),
      new ZaloHoanAlertsService(db, config),
    );
    jest.spyOn(primary, 'configuredRecipients').mockResolvedValue(['original-1']);
    const manager = { query } as unknown as EntityManager;
    const chat = {
      ...inquiry,
      eventId: 'message-abc',
      kind: 'chat' as const,
      senderRole: 'provider' as const,
    };
    await primary.enqueue(manager, chat);
    await primary.enqueue(manager, chat);
    expect(query).toHaveBeenCalledTimes(6);
    const first = query.mock.calls.slice(0, 3);
    const second = query.mock.calls.slice(3, 6);
    const keys = first.map((call) => call[1][0]);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toContain('mocmaria.zalo.outbox.');
    expect(keys[1]).toContain(linhDanOutboxPrefix);
    expect(keys[2]).toContain(hoanOutboxPrefix);
    expect(second.map((call) => call[1][0])).toEqual(keys);
    for (const [, args] of first) {
      const delivery = JSON.parse(args[1]) as { text: string };
      expect(delivery.text).toContain('Người gửi: KTV');
      expect(delivery.text).not.toContain('Booking request body');
    }
  });

  it('does not affect the old bot and delivers only from the isolated outbox', async () => {
    const { secondary, query } = setup();
    query
      .mockResolvedValueOnce([
        {
          key: hoanOutboxPrefix + 'test-key',
          value: { recipient: 'hoan-1', text: 'Booking request', attempts: 0 },
        },
      ])
      .mockResolvedValue([]);
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await secondary.drain();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('third-bot-test/sendMessage'),
      expect.objectContaining({
        body: JSON.stringify({ chat_id: 'hoan-1', text: 'Booking request' }),
      }),
    );
    expect(query.mock.calls[0][1][0]).toBe(hoanOutboxPrefix + '%');
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
          key: hoanOutboxPrefix + 'test-key',
          value: { recipient: 'hoan-1', text: 'Booking request', attempts: 11 },
        },
      ])
      .mockResolvedValue([]);
    global.fetch = jest.fn().mockRejectedValue(new Error('third-bot-test'));
    await expect(secondary.drain()).resolves.toBeUndefined();
    expect(JSON.parse(query.mock.calls[1][1][1])).toMatchObject({
      status: 'failed',
      attempts: 12,
    });
  });
});
