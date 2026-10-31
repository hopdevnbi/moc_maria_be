import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ZaloLinhDanWebhookController,
  linhDanPendingPrefix,
} from './zalo-linh-dan-webhook.controller';

describe('Isolated Linh Dan Zalo webhook', () => {
  const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
  const controller = new ZaloLinhDanWebhookController(
    { query } as unknown as DataSource,
    {
      get: (key: string): string | undefined =>
        key === 'ZALO_LINH_DAN_WEBHOOK_SECRET' ? 'secondary-test-secret' : undefined,
    } as ConfigService,
  );
  beforeEach(() => query.mockClear());

  it('requires the secondary webhook secret', async () => {
    await expect(controller.receive('wrong', {})).rejects.toThrow('Webhook');
    await expect(controller.receive(undefined, {})).rejects.toThrow('Webhook');
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts verification probes without selecting a recipient', async () => {
    await expect(controller.receive('secondary-test-secret', {})).resolves.toEqual({ ok: true });
    expect(query).not.toHaveBeenCalled();
  });

  it('stores only a pending candidate for a human sender', async () => {
    const message = {
      event_name: 'message.text.received',
      message: {
        from: { is_bot: false },
        chat: { id: 'private-recipient', chat_type: 'PRIVATE' },
        text: 'K\u1ebft n\u1ed1i M\u1ed9c Maria',
      },
    };
    await expect(controller.receive('secondary-test-secret', message)).resolves.toEqual({
      ok: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1][0]).toContain(linhDanPendingPrefix);
    const pending = JSON.parse(query.mock.calls[0][1][1]) as Record<string, string>;
    expect(pending['chatId']).toBe('private-recipient');
    expect(pending['chatType']).toBe('PRIVATE');
    expect(pending).not.toHaveProperty('text');
  });

  it('ignores unqualified requests and messages sent by bots', async () => {
    await controller.receive('secondary-test-secret', {
      event_name: 'message.text.received',
      message: {
        from: { is_bot: true },
        chat: { id: 'bot-123', chat_type: 'PRIVATE' },
        text: 'K\u1ebft n\u1ed1i M\u1ed9c Maria',
      },
    });
    expect(query).not.toHaveBeenCalled();
  });
});
