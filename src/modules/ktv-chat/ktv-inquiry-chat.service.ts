import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService, type KtvThread } from './ktv-chat.service';

@Injectable()
export class KtvInquiryChatService {
  constructor(
    private readonly db: DataSource,
    private readonly chat: KtvChatService,
  ) {}

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
