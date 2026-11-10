import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ZaloKtvWebhookController } from './zalo-ktv-webhook.controller';

describe('Staff Zalo Bot secure webhook and enrollment', () => {
  const secretByKey = new Map([
    ['ZALO_TIEN_MANH_WEBHOOK_SECRET', 'manh-test-secret'],
    ['ZALO_TUNG_WEBHOOK_SECRET', 'tung-test-secret'],
    ['ZALO_NGUYET_WEBHOOK_SECRET', 'nguyet-test-secret'],
    ['ZALO_THANH_THANH_WEBHOOK_SECRET', 'thanh-thanh-test-secret'],
  ]);
  const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
  const controller = new ZaloKtvWebhookController(
    { query } as unknown as DataSource,
    { get: (key: string): string | undefined => secretByKey.get(key) } as ConfigService,
  );
  const event = {
    event_name: 'message.text.received',
    message: {
      from: { id: 'approved-candidate', display_name: 'KTV', is_bot: false },
      chat: { id: 'approved-candidate', chat_type: 'PRIVATE' },
      text: 'Kết nối Mộc Maria',
    },
  };
  beforeEach(() => query.mockClear());

  it.each([
    ['tien-manh', 'manh-test-secret', 'tien-manh'],
    ['tung', 'tung-test-secret', 'tung'],
    ['nguyet', 'nguyet-test-secret', 'nguyet'],
    ['thanh-thanh', 'thanh-thanh-test-secret', 'thanh-thanh'],
  ])(
    'accepts only %s own signature and stores a pending candidate',
    async (slug, secret, prefix) => {
      await expect(controller.receive(slug, secret, event)).resolves.toEqual({ ok: true });
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT(key) DO UPDATE');
      expect(params[0]).toContain(`mocmaria.zalo.staff.${prefix}.pending.`);
      expect(params[0].length).toBeLessThanOrEqual(100);
      const saved = JSON.parse(params[1]) as { chatId: string; chatType: string };
      expect(saved).toMatchObject({ chatId: 'approved-candidate', chatType: 'PRIVATE' });
      expect(saved).not.toHaveProperty('token');
    },
  );

  it('rejects cross-bot secrets and invalid routes before reading database', async () => {
    await expect(controller.receive('tung', 'manh-test-secret', event)).rejects.toThrow('Webhook');
    await expect(controller.receive('tung', undefined, event)).rejects.toThrow('Webhook');
    await expect(controller.receive('unknown', 'manh-test-secret', event)).rejects.toThrow();
    await expect(controller.receive('thanh-thanh', 'nguyet-test-secret', event)).rejects.toThrow(
      'Webhook',
    );
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
  it('does not enroll group chats or mismatched private sender identities', async () => {
    await controller.receive('nguyet', 'nguyet-test-secret', {
      ...event,
      message: { ...event.message, chat: { id: 'approved-candidate', chat_type: 'GROUP' } },
    });
    await controller.receive('nguyet', 'nguyet-test-secret', {
      ...event,
      message: { ...event.message, from: { id: 'different-sender', is_bot: false } },
    });
    expect(query).not.toHaveBeenCalled();
  });
  it('does not enroll a Thanh Thanh group or a different private sender', async () => {
    for (const message of [
      { ...event.message, chat: { id: 'approved-candidate', chat_type: 'GROUP' } },
      { ...event.message, from: { id: 'other-user', is_bot: false } },
    ]) {
      await controller.receive('thanh-thanh', 'thanh-thanh-test-secret', { ...event, message });
    }
    expect(query).not.toHaveBeenCalled();
  });
});
