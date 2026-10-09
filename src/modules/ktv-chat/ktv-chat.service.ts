import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProvidersService } from '../providers/providers.service';
import type { AuthUserContext } from '../identity/identity.types';

type ThreadRow = {
  id: string;
  customer_user_id: string;
  provider_user_id: string;
  provider_application_id: string;
  customer_name?: string;
  provider_name?: string;
  updated_at: Date;
};
type MessageRow = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: Date;
};

@Injectable()
export class KtvChatService {
  constructor(
    private readonly database: DataSource,
    private readonly providers: ProvidersService,
  ) {}

  private requireMember(actor: AuthUserContext): void {
    if (!actor.isActive || actor.mustChangePassword)
      throw new ForbiddenException('Tài khoản chưa sẵn sàng nhắn tin.');
    if (
      !actor.permissions.includes('customer.portal') &&
      !actor.permissions.includes('staff.portal')
    ) {
      throw new ForbiddenException('Tài khoản không được phép nhắn tin.');
    }
  }

  private async threadFor(actor: AuthUserContext, id: string): Promise<ThreadRow> {
    this.requireMember(actor);
    const rows = await this.database.query<ThreadRow[]>(
      'SELECT * FROM ktv_chat_threads WHERE id=$1 AND (customer_user_id=$2 OR provider_user_id=$2)',
      [id, actor.id],
    );
    if (!rows[0]) throw new NotFoundException('Không tìm thấy hội thoại.');
    return rows[0];
  }

  private async requirePublicProvider(providerApplicationId: string): Promise<{ userId: string }> {
    // Use same authoritative visibility and training gate as GET /providers.
    await this.providers.publicProvider(providerApplicationId);
    const rows = await this.database.query<Array<{ user_id: string }>>(
      "SELECT user_id FROM provider_applications WHERE id=$1 AND status='APPROVED'",
      [providerApplicationId],
    );
    if (!rows[0]) throw new NotFoundException('KTV chưa sẵn sàng.');
    return { userId: rows[0].user_id };
  }

  async open(actor: AuthUserContext, providerApplicationId: string): Promise<ThreadRow> {
    this.requireMember(actor);
    if (!actor.permissions.includes('customer.portal'))
      throw new ForbiddenException('Chỉ khách hàng có thể mở chat với KTV.');
    const provider = await this.requirePublicProvider(providerApplicationId);
    if (provider.userId === actor.id)
      throw new BadRequestException('Không thể tự nhắn tin cho mình.');
    const rows = await this.database.query<ThreadRow[]>(
      `INSERT INTO ktv_chat_threads (customer_user_id,provider_application_id,provider_user_id)
      VALUES ($1,$2,$3) ON CONFLICT (customer_user_id,provider_application_id)
      DO UPDATE SET provider_user_id = ktv_chat_threads.provider_user_id
      RETURNING id,customer_user_id,provider_application_id,provider_user_id,updated_at`,
      [actor.id, providerApplicationId, provider.userId],
    );
    return rows[0];
  }

  async list(actor: AuthUserContext): Promise<ThreadRow[]> {
    this.requireMember(actor);
    return this.database.query<ThreadRow[]>(
      `SELECT t.id, t.customer_user_id, t.provider_user_id, t.provider_application_id, t.updated_at,
       u.display_name AS customer_name, p.public_name AS provider_name
       FROM ktv_chat_threads t
       JOIN users u ON u.id=t.customer_user_id
       JOIN provider_applications p ON p.id=t.provider_application_id
       WHERE t.customer_user_id=$1 OR t.provider_user_id=$1
       ORDER BY t.updated_at DESC LIMIT 100`,
      [actor.id],
    );
  }

  async messages(actor: AuthUserContext, id: string): Promise<MessageRow[]> {
    await this.threadFor(actor, id);
    const rows = await this.database.query<MessageRow[]>(
      `SELECT id, thread_id, sender_user_id, body, created_at FROM (
        SELECT id,thread_id,sender_user_id,body,created_at
        FROM ktv_chat_messages WHERE thread_id=$1
        ORDER BY created_at DESC,id DESC LIMIT 80
      ) m ORDER BY created_at ASC,id ASC`,
      [id],
    );
    return rows;
  }

  async send(actor: AuthUserContext, id: string, raw: string): Promise<MessageRow> {
    const body = raw.trim();
    if (!body || body.length > 2000)
      throw new BadRequestException('Tin nhắn phải có 1–2000 ký tự.');
    const thread = await this.threadFor(actor, id);
    await this.requirePublicProvider(thread.provider_application_id);
    const result = await this.database.transaction(async (manager) => {
      // Serialize messages from a single sender, then rate limit durable across replicas.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'ktv-chat:' + actor.id,
      ]);
      const usage = await manager.query<Array<{ total: number }>>(
        "SELECT count(*)::int AS total FROM ktv_chat_messages WHERE sender_user_id=$1 AND created_at>now()-interval '60 seconds'",
        [actor.id],
      );
      if ((usage[0]?.total || 0) >= 15)
        throw new HttpException('Bạn gửi quá nhanh, vui lòng thử sau.', 429);
      const rows = await manager.query<MessageRow[]>(
        'INSERT INTO ktv_chat_messages(thread_id,sender_user_id,body) VALUES($1,$2,$3) RETURNING id,thread_id,sender_user_id,body,created_at',
        [id, actor.id, body],
      );
      await manager.query('UPDATE ktv_chat_threads SET updated_at=now() WHERE id=$1', [id]);
      return rows[0];
    });
    return result;
  }
}
