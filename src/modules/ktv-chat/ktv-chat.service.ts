import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ProvidersService } from '../providers/providers.service';
import type { AuthUserContext } from '../identity/identity.types';
import type { BlockKtvChatDto, SendKtvMessageDto } from './ktv-chat.dto';

export interface KtvThread {
  id: string;
  customer_user_id: string;
  provider_user_id: string;
  provider_application_id: string;
  provider_name: string;
  customer_name: string;
  updated_at: string;
  last_message: string | null;
  unread_count: number;
  blocked_by_me: boolean;
  blocked_by_other: boolean;
  my_block_expires_at: string | null;
  can_send: boolean;
}
export interface KtvMessage {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
}

@Injectable()
export class KtvChatService {
  constructor(
    private readonly db: DataSource,
    private readonly providers: ProvidersService,
  ) {}

  async list(actor: AuthUserContext): Promise<KtvThread[]> {
    return this.db.query(
      `SELECT t.id,t.customer_user_id,t.provider_user_id,t.provider_application_id,
      t.updated_at,p.public_name AS provider_name,u.display_name AS customer_name,
      EXISTS(SELECT 1 FROM ktv_chat_blocks b WHERE b.thread_id=t.id AND b.blocker_user_id=$1 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp())) AS blocked_by_me,
      EXISTS(SELECT 1 FROM ktv_chat_blocks b WHERE b.thread_id=t.id AND b.blocker_user_id<>$1 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp())) AS blocked_by_other,
      (SELECT expires_at FROM ktv_chat_blocks b WHERE b.thread_id=t.id AND b.blocker_user_id=$1 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp())) AS my_block_expires_at,
      NOT EXISTS(SELECT 1 FROM ktv_chat_blocks b WHERE b.thread_id=t.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp())) AS can_send,
      (SELECT body FROM ktv_chat_messages WHERE thread_id=t.id ORDER BY seq DESC LIMIT 1) AS last_message,
      (SELECT count(*)::int FROM ktv_chat_messages m WHERE m.thread_id=t.id AND m.sender_user_id<>$1
        AND m.seq>CASE WHEN t.customer_user_id=$1 THEN t.customer_read_seq ELSE t.provider_read_seq END) AS unread_count
      FROM ktv_chat_threads t JOIN provider_applications p ON p.id=t.provider_application_id
      JOIN users u ON u.id=t.customer_user_id
      WHERE t.customer_user_id=$1 OR t.provider_user_id=$1 ORDER BY t.updated_at DESC,t.id`,
      [actor.id],
    );
  }

  async open(actor: AuthUserContext, applicationId: string): Promise<KtvThread> {
    if (!actor.permissions.includes('customer.portal'))
      throw new ForbiddenException('Tài khoản khách hàng mới có thể bắt đầu hội thoại.');
    // Reuse the public directory's existing approval, consent and service eligibility gates.
    const provider = await this.providers.publicProvider(applicationId);
    if (!provider) throw new NotFoundException('KTV hiện không nhận hội thoại mới.');
    const [app] = await this.db.query<{ user_id: string }[]>(
      `SELECT p.user_id FROM provider_applications p JOIN users u ON u.id=p.user_id
       WHERE p.id=$1 AND p.status='APPROVED' AND u.is_active`,
      [applicationId],
    );
    if (!app) throw new NotFoundException('KTV hiện không nhận hội thoại mới.');
    if (app.user_id === actor.id)
      throw new BadRequestException('Không thể mở hội thoại với chính mình.');
    await this.db.query(
      `INSERT INTO ktv_chat_threads(customer_user_id,provider_user_id,provider_application_id)
      VALUES($1,$2,$3) ON CONFLICT(customer_user_id,provider_application_id) DO NOTHING`,
      [actor.id, app.user_id, applicationId],
    );
    const thread = (await this.list(actor)).find(
      (t) => t.provider_application_id === applicationId && t.customer_user_id === actor.id,
    );
    if (!thread) throw new NotFoundException();
    return thread;
  }

  private async member(
    manager: EntityManager,
    actorId: string,
    threadId: string,
    lock = false,
  ): Promise<{
    customer_user_id: string;
    provider_user_id: string;
    provider_application_id: string;
  }> {
    const [thread] = await manager.query<
      { customer_user_id: string; provider_user_id: string; provider_application_id: string }[]
    >(
      `SELECT customer_user_id,provider_user_id,provider_application_id FROM ktv_chat_threads
       WHERE id=$1 AND (customer_user_id=$2 OR provider_user_id=$2)${lock ? ' FOR UPDATE' : ''}`,
      [threadId, actorId],
    );
    // Non-members get the same response as an unknown thread, including administrators.
    if (!thread) throw new NotFoundException('Không tìm thấy hội thoại.');
    return thread;
  }

  async messages(actor: AuthUserContext, threadId: string, before?: string): Promise<KtvMessage[]> {
    await this.member(this.db.manager, actor.id, threadId);
    if (before) {
      const [cursor] = await this.db.query<{ id: string }[]>(
        `SELECT id FROM ktv_chat_messages WHERE id=$1 AND thread_id=$2`,
        [before, threadId],
      );
      if (!cursor) throw new BadRequestException('Mốc tin nhắn không hợp lệ.');
    }
    const rows = await this.db.query<KtvMessage[]>(
      `SELECT id,thread_id,sender_user_id,body,created_at
      FROM ktv_chat_messages WHERE thread_id=$1
      AND ($2::uuid IS NULL OR seq<(SELECT seq FROM ktv_chat_messages WHERE id=$2 AND thread_id=$1))
      ORDER BY seq DESC LIMIT 50`,
      [threadId, before ?? null],
    );
    return rows.reverse();
  }

  async send(
    actor: AuthUserContext,
    threadId: string,
    dto: SendKtvMessageDto,
  ): Promise<KtvMessage> {
    const body = dto.body.trim();
    if (!body || body.length > 2000)
      throw new BadRequestException('Tin nhắn cần từ 1 đến 2000 ký tự.');
    return this.db.transaction(async (manager) => {
      const thread = await this.member(manager, actor.id, threadId, true);
      const clientId = dto.clientMessageId ?? randomUUID();
      const [existing] = await manager.query<KtvMessage[]>(
        `SELECT id,thread_id,sender_user_id,body,created_at FROM ktv_chat_messages
        WHERE thread_id=$1 AND sender_user_id=$2 AND client_message_id=$3`,
        [threadId, actor.id, clientId],
      );
      if (existing) {
        if (existing.body !== body) throw new BadRequestException('Mã tin nhắn đã được sử dụng.');
        return existing;
      }
      const [blocked] = await manager.query<{ thread_id: string }[]>(
        `SELECT thread_id FROM ktv_chat_blocks WHERE thread_id=$1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at>clock_timestamp()) LIMIT 1`,
        [threadId],
      );
      if (blocked)
        throw new ForbiddenException('Hội thoại đang bị chặn. Chỉ có thể xem lịch sử tin nhắn.');
      const [active] = await manager.query<{ id: string }[]>(
        `SELECT p.id FROM provider_applications p
        JOIN users provider ON provider.id=p.user_id JOIN users customer ON customer.id=$2
        WHERE p.id=$1 AND p.status='APPROVED' AND provider.is_active AND customer.is_active`,
        [thread.provider_application_id, thread.customer_user_id],
      );
      if (!active) throw new ForbiddenException('Hội thoại hiện chỉ cho phép xem lịch sử.');
      const [rate] = await manager.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM ktv_chat_messages
        WHERE thread_id=$1 AND sender_user_id=$2 AND created_at>now()-interval '1 minute'`,
        [threadId, actor.id],
      );
      if (rate.count >= 30)
        throw new HttpException('Bạn gửi tin nhắn quá nhanh. Vui lòng chờ một chút.', 429);
      const [message] = await manager.query<KtvMessage[]>(
        `INSERT INTO ktv_chat_messages(thread_id,sender_user_id,client_message_id,body)
        VALUES($1,$2,$3,$4) RETURNING id,thread_id,sender_user_id,body,created_at`,
        [threadId, actor.id, clientId, body],
      );
      await manager.query(`UPDATE ktv_chat_threads SET updated_at=clock_timestamp() WHERE id=$1`, [
        threadId,
      ]);
      return message;
    });
  }

  async read(actor: AuthUserContext, threadId: string, messageId: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      const thread = await this.member(manager, actor.id, threadId, true);
      const column =
        thread.customer_user_id === actor.id ? 'customer_read_seq' : 'provider_read_seq';
      const [message] = await manager.query<{ id: string }[]>(
        `SELECT id FROM ktv_chat_messages WHERE id=$1 AND thread_id=$2`,
        [messageId, threadId],
      );
      if (!message) throw new BadRequestException('Tin nhắn không thuộc hội thoại.');
      await manager.query(
        `UPDATE ktv_chat_threads SET ${column}=GREATEST(${column},m.seq)
        FROM ktv_chat_messages m WHERE ktv_chat_threads.id=$1 AND m.id=$2 AND m.thread_id=$1`,
        [threadId, messageId],
      );
    });
  }
  async block(actor: AuthUserContext, threadId: string, dto: BlockKtvChatDto): Promise<KtvThread> {
    if (dto.mode === 'PERMANENT' && dto.durationMinutes !== undefined)
      throw new BadRequestException('Chặn vĩnh viễn không có thời hạn.');
    await this.db.transaction(async (manager) => {
      await this.member(manager, actor.id, threadId, true);
      await manager.query(
        `INSERT INTO ktv_chat_blocks(thread_id,blocker_user_id,expires_at,reason)
        VALUES($1,$2,CASE WHEN $3::int IS NULL THEN NULL ELSE clock_timestamp()+$3*interval '1 minute' END,$4)
        ON CONFLICT(thread_id,blocker_user_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,
          reason=EXCLUDED.reason,revoked_at=NULL,created_at=clock_timestamp()`,
        [
          threadId,
          actor.id,
          dto.mode === 'TEMPORARY' ? dto.durationMinutes : null,
          dto.reason ?? null,
        ],
      );
      await manager.query(
        `INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('KTV_CHAT_BLOCK',$1,$2::jsonb)`,
        [
          actor.id,
          JSON.stringify({
            threadId,
            mode: dto.mode,
            durationMinutes: dto.durationMinutes ?? null,
          }),
        ],
      );
    });
    return (await this.list(actor)).find((t) => t.id === threadId)!;
  }
  async unblock(actor: AuthUserContext, threadId: string): Promise<KtvThread> {
    await this.db.transaction(async (manager) => {
      await this.member(manager, actor.id, threadId, true);
      await manager.query(
        `UPDATE ktv_chat_blocks SET revoked_at=clock_timestamp() WHERE thread_id=$1 AND blocker_user_id=$2 AND revoked_at IS NULL`,
        [threadId, actor.id],
      );
      await manager.query(
        `INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('KTV_CHAT_UNBLOCK',$1,$2::jsonb)`,
        [actor.id, JSON.stringify({ threadId })],
      );
    });
    return (await this.list(actor)).find((t) => t.id === threadId)!;
  }
}
