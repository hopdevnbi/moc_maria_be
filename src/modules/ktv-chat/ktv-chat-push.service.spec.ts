import webPush from 'web-push';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatPushService, trustedWebPushEndpoint } from './ktv-chat-push.service';

describe('KTV Web Push and tenant safety', () => {
  const keys = webPush.generateVAPIDKeys();
  const id = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const actor: AuthUserContext = {
    id,
    sessionId,
    email: null,
    phone: null,
    displayName: 'KTV',
    isActive: true,
    mustChangePassword: false,
    roles: ['THERAPIST'],
    permissions: [],
  };
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription',
    keys: { p256dh: 'aaaabbbbccccddddeeeeffffgggghhhh', auth: 'abcdefghijklmno' },
  };
  const env = { ...process.env };
  beforeEach(() => {
    process.env['WEB_PUSH_VAPID_PUBLIC_KEY'] = keys.publicKey;
    process.env['WEB_PUSH_VAPID_PRIVATE_KEY'] = keys.privateKey;
    process.env['WEB_PUSH_SUBJECT'] = 'mailto:notifications@example.invalid';
    delete process.env['CHAT_SERVICE_URL'];
    delete process.env['MOC_MARIA_CHAT_RELAY_KEY'];
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('rejects arbitrary URLs to prevent SSRF through push endpoints', () => {
    for (const host of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://web.push.apple.com/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-sjc2p.notify.windows.com/w/?token=abc',
    ])
      expect(trustedWebPushEndpoint(host)).toBe(true);
    for (const host of [
      'https://127.0.0.1/admin',
      'https://localhost/',
      'https://169.254.169.254/',
      'https://fcm.googleapis.com.attacker.invalid/',
      'https://fcm.googleapis.com:8443/abc',
      'http://fcm.googleapis.com/abc',
    ])
      expect(trustedWebPushEndpoint(host)).toBe(false);
  });

  it('allows customers and KTVs but rejects unrelated roles before changing subscriptions', async () => {
    const query = jest.fn();
    const service = new KtvChatPushService({ query } as unknown as DataSource);
    const customer = { ...actor, roles: ['CUSTOMER'] as AuthUserContext['roles'] };
    expect(service.config(customer)).toEqual({ publicKey: keys.publicKey });
    expect(service.config(actor)).toEqual({ publicKey: keys.publicKey });
    const admin = { ...actor, roles: ['ADMIN'] as AuthUserContext['roles'] };
    expect(() => service.config(admin)).toThrow('Chỉ khách hàng và KTV');
    await expect(service.subscribe(admin, subscription)).rejects.toThrow('Chỉ khách hàng và KTV');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects revoked customers before reading or mutating subscriptions', async () => {
    const query = jest.fn();
    const service = new KtvChatPushService({ query } as unknown as DataSource);
    const customer = { ...actor, roles: ['CUSTOMER'] as AuthUserContext['roles'] };
    const inactive = { ...customer, isActive: false };
    expect(() => service.config(inactive)).toThrow('Chỉ khách hàng và KTV');
    await expect(service.subscribe(inactive, subscription)).rejects.toThrow(
      'Chỉ khách hàng và KTV',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a valid, unrevoked login session', async () => {
    const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>().mockResolvedValueOnce([]);
    const service = new KtvChatPushService({ query } as unknown as DataSource);
    await expect(service.subscribe(actor, subscription)).rejects.toThrow('Phiên đăng nhập');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([sessionId, id]);
  });

  it('registers each endpoint for the current KTV and session only', async () => {
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]?]>()
      .mockResolvedValueOnce([{ id: sessionId }])
      .mockResolvedValueOnce([]);
    const service = new KtvChatPushService({ query } as unknown as DataSource);
    await service.subscribe(actor, subscription);
    expect(service.config(actor)).toEqual({ publicKey: keys.publicKey });
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT(endpoint_hash) DO UPDATE');
    expect(query.mock.calls[1][1]).toEqual([
      id,
      sessionId,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
    ]);
  });

  it('delivers a privacy-safe notice only to the other participant of a real thread', async () => {
    const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>().mockResolvedValueOnce([
      {
        endpoint_hash: 'hash',
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth_key: subscription.keys.auth,
      },
    ]);
    const send = jest.spyOn(webPush, 'sendNotification').mockResolvedValue({} as never);
    const service = new KtvChatPushService({ query } as unknown as DataSource);
    const messageId = '33333333-3333-4333-8333-333333333333';
    const threadId = '44444444-4444-4444-8444-444444444444';
    await service.notifyRecipient(id, messageId, threadId, 'customer');
    expect(query.mock.calls[0][1]).toEqual([id, threadId]);
    expect(query.mock.calls[0][0]).toContain('s.revoked_at IS NULL');
    expect(query.mock.calls[0][0]).toContain(
      't.customer_user_id=p.user_id OR t.provider_user_id=p.user_id',
    );
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(payload).toEqual({
      messageId,
      threadId,
      title: 'Mộc Maria',
      body: 'Bạn có tin nhắn mới từ khách hàng',
      url: '/tin-nhan?thread=' + threadId,
    });
    expect(JSON.stringify(payload)).not.toContain('Secret');
  });

  it('uses a generic KTV reply for customer devices without exposing private content', async () => {
    const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>().mockResolvedValueOnce([
      {
        endpoint_hash: 'hash',
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth_key: subscription.keys.auth,
      },
    ]);
    const send = jest.spyOn(webPush, 'sendNotification').mockResolvedValue({} as never);
    const service = new KtvChatPushService({ query } as unknown as DataSource);
    await service.notifyRecipient(
      id,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'provider',
    );
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(payload['body']).toBe('Bạn có tin nhắn mới từ KTV');
    expect(payload).not.toHaveProperty('messageBody');
  });
});
