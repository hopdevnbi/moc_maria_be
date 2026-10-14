import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ZaloBotService } from './zalo-bot.service';
import { ZaloAlertsService } from './zalo-alerts.service';

describe('Zalo webhook and operator connection', () => {
  const query = jest
    .fn<Promise<{ expiresAt: string }[]>, [string, string[]?]>()
    .mockResolvedValue([]);
  const transaction = jest.fn(async (work: (m: { query: typeof query }) => Promise<unknown>) =>
    work({ query }),
  );
  const alerts = { configuredRecipients: jest.fn().mockResolvedValue([]), enqueueText: jest.fn() };
  const values = new Map([
    ['ZALO_BOT_TOKEN', 'test-only'],
    ['ZALO_WEBHOOK_SECRET', 'test-webhook-secret'],
  ]);
  const bot = new ZaloBotService(
    { query, transaction } as unknown as DataSource,
    { get: (key: string) => values.get(key) } as ConfigService,
    alerts as unknown as ZaloAlertsService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue([]);
    alerts.configuredRecipients.mockResolvedValue([]);
  });
  it('rejects an unauthenticated webhook before database access', async () => {
    await expect(bot.receive(undefined, {})).rejects.toThrow('Webhook không hợp lệ');
    await expect(bot.receive('incorrect', {})).rejects.toThrow('Webhook không hợp lệ');
    expect(query).not.toHaveBeenCalled();
  });
  it('acknowledges verification probes and unsupported events', async () => {
    expect(await bot.receive('test-webhook-secret', {})).toEqual({
      ok: true,
    });
    expect(query).not.toHaveBeenCalled();
  });
  it('does not enroll a sender using the old unqualified connection phrase', async () => {
    await bot.receive('test-webhook-secret', {
      ok: true,
      result: {
        event_name: 'message.text.received',
        message: {
          from: { is_bot: false },
          chat: { id: 'untrusted', chat_type: 'PRIVATE' },
          text: 'Kết nối Mộc Maria',
        },
      },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(alerts.enqueueText).not.toHaveBeenCalled();
  });
  it('returns a usable pairing command but stores only its hash with a database expiry', async () => {
    query.mockResolvedValue([{ expiresAt: '2026-10-14T05:00:00Z' }]);
    const pair = await bot.createPairing();
    expect(pair.command).toMatch(/^Kết nối Mộc Maria [A-F0-9]{16}$/);
    expect(query.mock.calls[0][0]).toContain("interval '30 minutes'");
    expect(JSON.stringify(query.mock.calls[0][1])).not.toContain(pair.command.split(' ').at(-1));
  });
  it('does not enqueue a test if there are no recipients', async () => {
    await expect(bot.test()).rejects.toThrow('Chưa có người nhận');
    expect(transaction).not.toHaveBeenCalled();
  });
  it('queues a clearly labelled setup test without creating a booking or conversation', async () => {
    alerts.configuredRecipients.mockResolvedValue(['private-recipient']);
    const result = await bot.test();
    expect(result.queued).toBe(true);
    expect(alerts.enqueueText).toHaveBeenCalledWith(
      expect.anything(),
      'test:' + result.reference,
      expect.stringContaining('không tạo lịch hẹn hoặc hội thoại'),
    );
  });
});
