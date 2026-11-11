import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService, type KtvThread } from './ktv-chat.service';
import { canSupportChat, SUPPORT_MS, supportKey } from './ktv-chat-support';

@Injectable()
export class KtvInquiryChatService {
  constructor(
    private readonly db: DataSource,
    private readonly chat: KtvChatService,
  ) {}

  async support(
    actor: AuthUserContext,
    locator: string,
    kind: 'inquiry' | 'thread',
  ): Promise<KtvThread> {
    if (!canSupportChat(actor))
      throw new ForbiddenException('Chỉ super admin được hỗ trợ hội thoại.');
    if (
      !(kind === 'inquiry'
        ? /^[a-f0-9]{64}$/.test(locator)
        : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            locator,
          ))
    )
      throw new NotFoundException();
    const threadId = await this.db.transaction(async (manager) => {
      const [binding] = await manager.query<
        Array<{ customerId: string; providerId: string; providerUserId: string }>
      >(
        kind === 'inquiry'
          ? `SELECT m.value->>'customerId' AS "customerId",p.id AS "providerId",p.user_id AS "providerUserId"
             FROM app_metadata m JOIN provider_applications p ON p.id::text=m.value->>'providerId'
               AND p.user_id::text=m.value->>'providerUserId'
             JOIN users customer ON customer.id::text=m.value->>'customerId' AND customer.is_active
             JOIN users provider ON provider.id=p.user_id AND provider.is_active
             WHERE m.key=$1 AND customer.id<>p.user_id AND p.status NOT IN ('REJECTED','SUSPENDED')
               AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=p.user_id AND r.name='THERAPIST') FOR SHARE OF m,p`
          : `SELECT t.customer_user_id AS "customerId",p.id AS "providerId",p.user_id AS "providerUserId"
             FROM ktv_chat_threads t JOIN provider_applications p ON p.id=t.provider_application_id AND p.user_id=t.provider_user_id
             JOIN users customer ON customer.id=t.customer_user_id AND customer.is_active
             JOIN users provider ON provider.id=p.user_id AND provider.is_active
             WHERE t.id=$1 AND p.status NOT IN ('REJECTED','SUSPENDED')
               AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=p.user_id AND r.name='THERAPIST') FOR SHARE OF t,p`,
        [kind === 'inquiry' ? 'mocmaria.inquiry.' + locator : locator],
      );
      if (!binding) throw new NotFoundException('Không tìm thấy hội thoại cần hỗ trợ.');
      const [thread] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO ktv_chat_threads(customer_user_id,provider_user_id,provider_application_id)
         VALUES($1,$2,$3) ON CONFLICT(customer_user_id,provider_application_id)
         DO UPDATE SET provider_application_id=EXCLUDED.provider_application_id RETURNING id`,
        [binding.customerId, binding.providerUserId, binding.providerId],
      );
      const [privacy] = await manager.query<Array<{ protected: boolean }>>(
        `SELECT COALESCE(value ? 'passwordHash',false) AS protected FROM app_metadata WHERE key=$1`,
        ['mocmaria.chat.privacy.' + thread.id],
      );
      if (
        privacy?.protected &&
        actor.id !== binding.customerId &&
        actor.id !== binding.providerUserId
      )
        throw new ForbiddenException('Hội thoại có mật khẩu riêng; không thể mở hỗ trợ quản trị.');
      await manager.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key)
         DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
        [
          supportKey(thread.id, actor.id),
          JSON.stringify({
            actorId: actor.id,
            threadId: thread.id,
            locator,
            kind,
            expiresAt: new Date(Date.now() + SUPPORT_MS).toISOString(),
          }),
        ],
      );
      await manager.query(
        `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata) VALUES('KTV_CHAT_SUPPORT_ENTERED',$1,$2,$3::jsonb)`,
        [
          actor.id,
          binding.customerId,
          JSON.stringify({ threadId: thread.id, providerId: binding.providerId, locator, kind }),
        ],
      );
      return thread.id;
    });
    const thread = (await this.chat.list(actor)).find((row) => row.id === threadId);
    if (!thread) throw new NotFoundException();
    return thread;
  }

  async open(actor: AuthUserContext, inquiryId: string): Promise<KtvThread> {
    if (!/^[a-f0-9]{64}$/.test(inquiryId)) throw new NotFoundException();
    // The URL is a locator, never an authorization token or a customer identity.
    const threadId = await this.db.transaction(async (manager) => {
      const [inquiry] = await manager.query<Array<{ customerId: string; providerId: string }>>(
        `SELECT m.value->>'customerId' AS "customerId",p.id AS "providerId"
         FROM app_metadata m
         JOIN provider_applications p ON p.id::text=m.value->>'providerId'
           AND p.user_id=$2 AND p.user_id::text=m.value->>'providerUserId'
         JOIN users customer ON customer.id::text=m.value->>'customerId' AND customer.is_active
         JOIN users provider ON provider.id=p.user_id AND provider.is_active
         WHERE m.key=$1 AND customer.id<>p.user_id AND p.status NOT IN ('REJECTED','SUSPENDED')
           AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
             WHERE ur.user_id=p.user_id AND r.name='THERAPIST')
         FOR SHARE OF m,p`,
        ['mocmaria.inquiry.' + inquiryId, actor.id],
      );
      if (!inquiry) throw new NotFoundException('Không tìm thấy yêu cầu đặt lịch của bạn.');
      const [thread] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO ktv_chat_threads(customer_user_id,provider_user_id,provider_application_id)
         VALUES($1,$2,$3) ON CONFLICT(customer_user_id,provider_application_id)
         DO UPDATE SET provider_application_id=EXCLUDED.provider_application_id
         RETURNING id`,
        [inquiry.customerId, actor.id, inquiry.providerId],
      );
      return thread.id;
    });
    const thread = (await this.chat.list(actor)).find((row) => row.id === threadId);
    if (!thread) throw new NotFoundException();
    return thread;
  }
}
