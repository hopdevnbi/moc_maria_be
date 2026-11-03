import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ZaloKtvWebhookController } from './zalo-ktv-webhook.controller';

describe('Staff Zalo Bot secure webhook and enrollment', () => {
  const secretByKey = new Map([
    ['ZALO_TIEN_MANH_WEBHOOK_SECRET', 'manh-test-secret'],
    ['ZALO_TUNG_WEBHOOK_SECRET', 'tung-test-secret'],
    ['ZALO_NGUYET_WEBHOOK_SECRET', 'nguyet-test-secret'],
  ]);
  const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
  const controller = new ZaloKtvWebhookController(
    { query } as unknown as DataSource,
    { get: (key: string): string | undefined => secretByKey.get(key) } as ConfigService,
  );
  const event = {
    event_name: 'message.text.received',
    message: {
      from: { is_bot: false },
      chat: { id: 'approved-candidate', chat_type: 'PRIVATE' },
      text: 'Kết nối Mộc Maria',
    },
  };
  beforeEach(() => query.mockClear());

  it.each([
    ['tien-manh', 'manh-test-secret', 'tien-manh'],
    ['tung', 'tung-test-secret', 'tung'],
    ['nguyet', 'nguyet-test-secret', 'nguyet'],
  ])(
    'accepts only %s own signature and stores a pending candidate',
    async (slug, secret, prefix) => {
      await expect(controller.receive(slug, secret, event)).resolves.toEqual({ ok: true });
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT(key) DO UPDATE');
      expect(params[0]).toContain(`mocmaria.zalo.staff.${prefix}.pending.`);
      const saved = JSON.parse(params[1]) as { chatId: string; chatType: string };
      expect(saved).toMatchObject({ chatId: 'approved-candidate', chatType: 'PRIVATE' });
      expect(saved).not.toHaveProperty('token');
    },
  );

  it('rejects cross-bot secrets and invalid routes before reading database', async () => {
    await expect(controller.receive('tung', 'manh-test-secret', event)).rejects.toThrow('Webhook');
    await expect(controller.receive('tung', undefined, event)).rejects.toThrow('Webhook');
    await expect(controller.receive('unknown', 'manh-test-secret', event)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('ignores probes, incoming messages not requesting connection and bot messages', async () => {
    await controller.receive('tung', 'tung-test-secret', {});
    await controller.receive('tung', 'tung-test-secret', {
      ...event,
      message: { ...event.message, text: 'Just chatting' },
    });
    await controller.receive('tung', 'tung-test-secret', {
      ...event,
      message: { ...event.message, from: { is_bot: true } },
    });
    expect(query).not.toHaveBeenCalled();
  });
});
