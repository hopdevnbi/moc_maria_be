import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { canSupportChat } from './ktv-chat-support';

export interface MonitorMessage {
  id: string;
  seq: string;
  threadId: string;
  customerName: string;
  providerName: string;
  senderName: string;
  senderRole: 'customer' | 'provider' | 'support';
  body: string | null;
  imageUrl: string | null;
  protected: boolean;
  createdAt: Date;
}
export interface MonitorPage {
  items: MonitorMessage[];
  nextBefore: string | null;
}
export function assertMonitorAccess(actor: AuthUserContext): void {
  if (!canSupportChat(actor)) throw new ForbiddenException('CHAT_MONITOR_FORBIDDEN');
}
@Injectable()
export class KtvChatMonitorService {
  constructor(private readonly db: DataSource) {}
  async list(actor: AuthUserContext, before?: string, threadId?: string): Promise<MonitorPage> {
    assertMonitorAccess(actor);
    return this.db.transaction(async (manager) => {
      if (threadId) {
        const [thread] = await manager.query<{ id: string }[]>(
          'SELECT id FROM ktv_chat_threads WHERE id=$1',
          [threadId],
        );
        if (!thread) throw new NotFoundException('CHAT_THREAD_NOT_FOUND');
      }
      // Scope audit records to actor + quarter hour. No chat text, names or tokens in logs.
      const key = 'mocmaria.chat.monitor.audit.' + actor.id;
      const bucket = Math.floor(Date.now() / 900000);
      const changed = await manager.query<{ key: string }[]>(
        `INSERT INTO app_metadata(key,value) VALUES($1,jsonb_build_object('bucket',$2::bigint))
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()
         WHERE app_metadata.value IS DISTINCT FROM EXCLUDED.value RETURNING key`,
        [key, bucket],
      );
      if (changed.length) {
        await manager.query(
          "INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('KTV_CHAT_MONITOR_ACCESSED',$1,'{}'::jsonb)",
          [actor.id],
        );
      }
      const rows = await manager.query<MonitorMessage[]>(
        `
        SELECT m.id,m.seq::text AS seq,t.id AS "threadId",u.display_name AS "customerName",p.public_name AS "providerName",
          sender.display_name AS "senderName",
          CASE WHEN m.sender_user_id=t.customer_user_id THEN 'customer'
               WHEN m.sender_user_id=t.provider_user_id THEN 'provider' ELSE 'support' END AS "senderRole",
          CASE WHEN COALESCE(privacy.value ? 'passwordHash',false) THEN NULL ELSE m.body END AS body,
          CASE WHEN COALESCE(privacy.value ? 'passwordHash',false) THEN NULL ELSE attachment.value->>'url' END AS "imageUrl",
          COALESCE(privacy.value ? 'passwordHash',false) AS protected,m.created_at AS "createdAt"
        FROM ktv_chat_messages m
        JOIN ktv_chat_threads t ON t.id=m.thread_id
        JOIN users u ON u.id=t.customer_user_id
        JOIN provider_applications p ON p.id=t.provider_application_id
        JOIN users sender ON sender.id=m.sender_user_id
        LEFT JOIN app_metadata privacy ON privacy.key='mocmaria.chat.privacy.'||t.id::text
        LEFT JOIN app_metadata attachment ON attachment.key='mocmaria.chat.image.'||m.id::text
        WHERE ($1::bigint IS NULL OR m.seq<$1) AND ($2::uuid IS NULL OR t.id=$2)
        ORDER BY m.seq DESC LIMIT 61`,
        [before ?? null, threadId ?? null],
      );
      const items = rows.slice(0, 60);
      return { items, nextBefore: rows.length > 60 ? items[items.length - 1].seq : null };
    });
  }
}
