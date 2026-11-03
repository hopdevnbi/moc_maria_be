import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { ProvidersService } from '../providers/providers.service';
import { ZaloAlertsService } from '../zalo-alerts/zalo-alerts.service';
import { KtvChatPrivacyService } from './ktv-chat-privacy.service';
import { KtvChatService } from './ktv-chat.service';
import { KtvChatPushService } from './ktv-chat-push.service';

describe('KTV chat notifications', () => {
  const customer = '11111111-1111-4111-8111-111111111111';
  const provider = '22222222-2222-4222-8222-222222222222';
  const app = '33333333-3333-4333-8333-333333333333';
  const thread = '44444444-4444-4444-8444-444444444444';
  const id = '55555555-5555-4555-8555-555555555555';
  const actor = (userId: string): AuthUserContext => ({
    id: userId,
    email: null,
    phone: null,
    displayName: 'Sender',
    isActive: true,
    mustChangePassword: false,
    sessionId: 'test-session',
    roles: [],
    permissions: [],
  });
  function setup(
    duplicate = false,
    protectedThread = false,
  ): {
    service: KtvChatService;
    notify: jest.Mock<Promise<void>, [unknown, unknown]>;
    push: jest.Mock;
    query: jest.Mock<Promise<unknown[]>, [string]>;
  } {
    const notify = jest.fn<Promise<void>, [unknown, unknown]>().mockResolvedValue(undefined);
    const push = jest.fn().mockResolvedValue(undefined);
    const query = jest
      .fn<Promise<unknown[]>, [string]>()
      .mockImplementation(async (sql: string) => {
        await Promise.resolve();
        if (sql.includes('FROM ktv_chat_threads') && sql.includes('FOR UPDATE'))
          return [
            {
              customer_user_id: customer,
              provider_user_id: provider,
              provider_application_id: app,
            },
          ];
        if (sql.includes('FROM ktv_chat_messages') && sql.includes('client_message_id'))
          return duplicate ? [{ id, body: 'Secret', thread_id: thread }] : [];
        if (sql.includes('FROM ktv_chat_blocks') || sql.includes('CROSS JOIN LATERAL')) return [];
        if (sql.includes('SELECT p.id FROM provider_applications')) return [{ id: app }];
        if (sql.includes('SELECT count(*)::int AS count')) return [{ count: 0 }];
        if (sql.includes('INSERT INTO ktv_chat_messages'))
          return [{ id, body: 'Secret', thread_id: thread }];
        if (sql.includes("SELECT value->>'url' AS url FROM app_metadata")) return [];
        if (sql.includes('FROM app_metadata') && sql.includes('passwordHash'))
          return protectedThread ? [{ isProtected: true }] : [];
        if (sql.includes('SELECT customer.display_name AS'))
          return [{ customerName: 'Khách', providerName: 'KTV' }];
        if (sql.includes('UPDATE ktv_chat_threads')) return [];
        throw new Error('Unexpected SQL');
      });
    const m = { query };
    const db = { transaction: async (cb: (manager: typeof m) => Promise<unknown>) => cb(m) };
    const service = new KtvChatService(
      db as unknown as DataSource,
      {} as ProvidersService,
      { assertAccess: jest.fn().mockResolvedValue(undefined) } as unknown as KtvChatPrivacyService,
      { enqueue: notify } as unknown as ZaloAlertsService,
      { notifyRecipient: push } as unknown as KtvChatPushService,
    );
    return { service, notify, query, push };
  }
  it.each([
    [customer, 'customer'],
    [provider, 'provider'],
  ] as const)('notifies a newly stored message from %s', async (who, senderRole) => {
    const { service, notify } = setup();
    await service.send(actor(who), thread, { body: 'Secret', clientMessageId: id });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({
      kind: 'chat',
      eventId: id,
      customerName: 'Khách',
      providerName: 'KTV',
      senderRole,
    });
    expect(notify.mock.calls[0][1]).toMatchObject({
      messageBody: 'Secret',
      chatPrivacyProtected: false,
    });
  });
  it('does not forward content of password-protected conversations', async () => {
    const { service, notify } = setup(false, true);
    await service.send(actor(customer), thread, { body: 'Secret', clientMessageId: id });
    expect(notify.mock.calls[0][1]).toMatchObject({ chatPrivacyProtected: true });
    expect(JSON.stringify(notify.mock.calls[0][1])).not.toContain('Secret');
  });
  it.each([customer, provider])(
    'never pushes or queues Zalo when %s retries a message',
    async (senderId) => {
      const { service, notify, push } = setup(true);
      await service.send(actor(senderId), thread, { body: 'Secret', clientMessageId: id });
      expect(notify).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    },
  );
  it('targets only the proper KTV for a new customer message', async () => {
    const { service, push } = setup();
    await service.send(actor(customer), thread, { body: 'Secret', clientMessageId: id });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(provider, id, thread, 'customer');
    expect(JSON.stringify(push.mock.calls[0])).not.toContain('Secret');
  });
  it('notifies the correct customer when the KTV replies', async () => {
    const { service, push } = setup();
    await service.send(actor(provider), thread, { body: 'Secret', clientMessageId: id });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(customer, id, thread, 'provider');
    expect(JSON.stringify(push.mock.calls[0])).not.toContain('Secret');
  });
});
