import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import webPush from 'web-push';
import type { AuthUserContext } from '../identity/identity.types';
import type { KtvPushSubscriptionDto } from './ktv-chat-push.dto';

type StoredSubscription = {
  endpoint_hash: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};
const endpointHash = (value: string): string => createHash('sha256').update(value).digest('hex');

// Push endpoints must be issued by known browser push services; never allow
// arbitrary user-provided HTTPS endpoints to become an authenticated SSRF target.
export function trustedWebPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      (host === 'fcm.googleapis.com' ||
        host === 'updates.push.services.mozilla.com' ||
        host === 'web.push.apple.com' ||
        host === 'push.services.mozilla.com' ||
        host.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}

@Injectable()
export class KtvChatPushService {
  private readonly logger = new Logger(KtvChatPushService.name);
  private readonly publicKey = process.env['WEB_PUSH_VAPID_PUBLIC_KEY']?.trim() || '';
  private readonly privateKey = process.env['WEB_PUSH_VAPID_PRIVATE_KEY']?.trim() || '';
  private readonly subject = process.env['WEB_PUSH_SUBJECT']?.trim() || '';
  private readonly enabled = !!this.publicKey && !!this.privateKey && !!this.subject;

  constructor(private readonly db: DataSource) {
    if (this.enabled) webPush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
  }

  private ensureChatUser(actor: AuthUserContext): void {
    if (
      !actor.isActive ||
      !actor.roles.some((role) => ['CUSTOMER', 'THERAPIST', 'DOCTOR_CONSULTANT'].includes(role))
    )
      throw new ForbiddenException('Chỉ khách hàng và KTV mới có thể bật thông báo chat.');
  }

  config(actor: AuthUserContext): { publicKey: string | null } {
    this.ensureChatUser(actor);
    return { publicKey: this.enabled ? this.publicKey : null };
  }

  async subscribe(actor: AuthUserContext, subscription: KtvPushSubscriptionDto): Promise<void> {
    this.ensureChatUser(actor);
    if (!this.enabled) throw new ServiceUnavailableException('Thông báo đẩy chưa được cấu hình.');
    if (!trustedWebPushEndpoint(subscription.endpoint))
      throw new BadRequestException('Máy chủ thông báo của thiết bị không được hỗ trợ.');

    const active = await this.db.query<Array<{ id: string }>>(
      'SELECT id FROM refresh_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()',
      [actor.sessionId, actor.id],
    );
    if (!active.length) throw new ForbiddenException('Phiên đăng nhập đã hết hạn.');
    await this.db.query(
      `INSERT INTO ktv_chat_push_subscriptions
       (user_id,session_id,endpoint_hash,endpoint,p256dh,auth_key)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(endpoint_hash) DO UPDATE SET
       user_id=excluded.user_id,session_id=excluded.session_id,
       endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth_key=excluded.auth_key,
       updated_at=clock_timestamp()`,
      [
        actor.id,
        actor.sessionId,
        endpointHash(subscription.endpoint),
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
      ],
    );
  }

  async unsubscribe(actor: AuthUserContext, endpoint: string): Promise<void> {
    this.ensureChatUser(actor);
    await this.db.query(
      'DELETE FROM ktv_chat_push_subscriptions WHERE user_id=$1 AND endpoint_hash=$2',
      [actor.id, endpointHash(endpoint)],
    );
  }

  // Best effort: never fail an already committed private chat message.
  async notifyRecipient(
    recipientUserId: string,
    messageId: string,
    threadId: string,
    senderRole: 'customer' | 'provider',
  ): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];
    if (this.enabled)
      tasks.push(this.sendWebPush(recipientUserId, messageId, threadId, senderRole));
    const socketBase = process.env['CHAT_SERVICE_URL'];
    const relayKey = process.env['MOC_MARIA_CHAT_RELAY_KEY'];
    if (socketBase && relayKey && relayKey.length >= 32) {
      tasks.push(this.sendSocketEvent(socketBase, relayKey, recipientUserId, messageId, threadId));
    }
    await Promise.allSettled(tasks);
  }

  private async sendSocketEvent(
    socketBase: string,
    relayKey: string,
    recipientUserId: string,
    messageId: string,
    threadId: string,
  ): Promise<void> {
    try {
      const response = await fetch(
        socketBase.replace(/\/$/, '') + '/internal/moc-maria-chat-events',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + relayKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipientUserId, messageId, threadId }),
          signal: AbortSignal.timeout(4500),
        },
      );
      if (!response.ok) this.logger.warn('Mộc Maria relay HTTP ' + response.status);
    } catch {
      this.logger.warn('Mộc Maria Socket relay could not be reached.');
    }
  }

  private async sendWebPush(
    recipientUserId: string,
    messageId: string,
    threadId: string,
    senderRole: 'customer' | 'provider',
  ): Promise<void> {
    const subscriptions = await this.db.query<StoredSubscription[]>(
      `SELECT p.endpoint_hash,p.endpoint,p.p256dh,p.auth_key
       FROM ktv_chat_push_subscriptions p
       JOIN refresh_sessions s ON s.id=p.session_id AND s.user_id=p.user_id
       JOIN users u ON u.id=p.user_id
       WHERE p.user_id=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
       AND u.is_active
       AND EXISTS (
         SELECT 1 FROM ktv_chat_threads t WHERE t.id=$2
         AND (t.customer_user_id=p.user_id OR t.provider_user_id=p.user_id)
       )`,
      [recipientUserId, threadId],
    );
    // No customer identity, message text or protected conversation content.
    const payload = JSON.stringify({
      messageId,
      threadId,
      title: 'Mộc Maria',
      body:
        senderRole === 'customer'
          ? 'Bạn có tin nhắn mới từ khách hàng'
          : 'Bạn có tin nhắn mới từ KTV',
      url: '/tin-nhan?thread=' + threadId,
    });
    await Promise.allSettled(
      subscriptions.map(async (row) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth_key },
            },
            payload,
            { TTL: 3600, urgency: 'high' },
          );
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.db.query('DELETE FROM ktv_chat_push_subscriptions WHERE endpoint_hash=$1', [
              row.endpoint_hash,
            ]);
          } else {
            this.logger.warn('Web Push delivery failed with status ' + (status || 'unknown'));
          }
        }
      }),
    );
  }
}
