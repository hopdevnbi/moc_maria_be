import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { normalizeEmail, normalizePhone } from '../identity/identity-normalization';
import { KtvChatService } from '../ktv-chat/ktv-chat.service';
import { mocMariaEmailJob } from '../../shared/email/moc-maria-email';
import type { CreateCustomerAccountDto } from './admin-intake.dto';

const esc = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (v) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[v]!,
  );

@Injectable()
export class AdminIntakeService {
  constructor(
    private readonly db: DataSource,
    private readonly chat: KtvChatService,
    private readonly config: ConfigService,
  ) {}

  private superAdmin(actor: AuthUserContext): void {
    if (!actor.roles.includes('SUPER_ADMIN') || !actor.permissions.includes('customers.manage'))
      throw new ForbiddenException('Chỉ Super Admin được cấp tài khoản khách hàng.');
  }

  async options(
    actor: AuthUserContext,
    q: string,
  ): Promise<{
    customers: Array<{
      id: string;
      displayName: string;
      email: string | null;
      phone: string | null;
    }>;
    providers: Awaited<ReturnType<KtvChatService['directory']>>;
  }> {
    this.superAdmin(actor);
    const term = q.trim().slice(0, 100) || null;
    const [customers, providers] = await Promise.all([
      this.db.query<
        Array<{ id: string; displayName: string; email: string | null; phone: string | null }>
      >(
        `SELECT u.id,u.display_name AS "displayName",u.email,u.phone FROM users u JOIN customers c ON c.user_id=u.id
         WHERE u.is_active AND ($1::text IS NULL OR POSITION(lower($1) IN lower(u.display_name))>0
         OR POSITION(lower($1) IN lower(COALESCE(u.email,'')))>0 OR POSITION(lower($1) IN lower(COALESCE(u.phone,'')))>0)
         ORDER BY u.created_at DESC LIMIT 30`,
        [term],
      ),
      this.chat.directory(),
    ]);
    return { customers, providers };
  }

  async createCustomer(
    actor: AuthUserContext,
    dto: CreateCustomerAccountDto,
  ): Promise<{
    customer: { id: string; displayName: string; email: string | null; phone: string | null };
    temporaryPassword: string;
    mustChangePassword: true;
    emailStatus: 'QUEUED' | 'NOT_REQUESTED' | 'NOT_CONFIGURED' | 'FAILED';
  }> {
    this.superAdmin(actor);
    const displayName = dto.displayName.trim();
    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    if (!email && !phone) throw new BadRequestException('Cần email hoặc số điện thoại đăng nhập.');
    if (dto.sendEmail && !email)
      throw new BadRequestException('Muốn gửi email, cần địa chỉ email hợp lệ.');
    const temporaryPassword = 'Mm9-' + randomBytes(18).toString('base64url');
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const setupToken = dto.sendEmail && email ? randomBytes(40).toString('base64url') : null;
    let id: string;
    try {
      id = await this.db.transaction(async (m) => {
        const [role] = await m.query<Array<{ id: string }>>('SELECT id FROM roles WHERE name=$1', [
          'CUSTOMER',
        ]);
        if (!role) throw new ConflictException('Vai trò CUSTOMER chưa được thiết lập.');
        const [user] = await m.query<Array<{ id: string }>>(
          `INSERT INTO users(email,phone,display_name,password_hash,is_active,must_change_password)
           VALUES($1,$2,$3,$4,true,true) RETURNING id`,
          [email, phone, displayName, passwordHash],
        );
        await m.query(
          'INSERT INTO customers(user_id,contact_preferences) VALUES($1::uuid,$2::jsonb)',
          [user.id, '{}'],
        );
        await m.query('INSERT INTO user_roles(user_id,role_id) VALUES($1::uuid,$2::uuid)', [
          user.id,
          role.id,
        ]);
        if (setupToken) {
          await m.query(
            `INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
             VALUES($1::uuid,$2,clock_timestamp()+interval '45 minutes')`,
            [user.id, createHash('sha256').update(setupToken).digest('hex')],
          );
        }
        await m.query(
          `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata)
          VALUES('ADMIN_CUSTOMER_CREATED',$1::uuid,$2::uuid,$3::jsonb)`,
          [
            actor.id,
            user.id,
            JSON.stringify({ source: 'admin-intake', setupEmailRequested: !!setupToken }),
          ],
        );
        return user.id;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new ConflictException(
          'Email hoặc số điện thoại đã được đăng ký. Hãy tìm khách hiện có.',
        );
      throw error;
    }
    let emailStatus: 'QUEUED' | 'NOT_REQUESTED' | 'NOT_CONFIGURED' | 'FAILED' = 'NOT_REQUESTED';
    if (setupToken && email) {
      const base = this.config.get<string>('QUEUE_SERVICE_URL')?.trim();
      const key = this.config.get<string>('QUEUE_API_KEY')?.trim();
      if (!base || !key) emailStatus = 'NOT_CONFIGURED';
      else {
        const url = `https://mocmaria.com/dat-lai-mat-khau?token=${encodeURIComponent(setupToken)}`;
        const content = {
          subject: 'Thiết lập tài khoản Mộc Maria của bạn',
          text: `Xin chào ${displayName},\nMộc Maria đã tạo tài khoản cho bạn.\nTên đăng nhập: ${email}\nThiết lập mật khẩu trong vòng 45 phút tại: ${url}\nNếu bạn không yêu cầu, vui lòng liên hệ Mộc Maria.`,
          html: `<html lang="vi"><head><meta charset="UTF-8"></head><body style="font-family:Arial,Tahoma,sans-serif;color:#244331"><h2>Chào mừng đến với Mộc Maria</h2><p>Xin chào ${esc(displayName)}, tài khoản của bạn đã được tạo.</p><p>Tên đăng nhập: <strong>${esc(email)}</strong></p><p><a href="${esc(url)}">Thiết lập mật khẩu an toàn</a> (có hiệu lực 45 phút, chỉ dùng một lần).</p><p>Chúng tôi không gửi mật khẩu qua email. Nếu bạn không yêu cầu, vui lòng liên hệ Mộc Maria.</p></body></html>`,
        };
        try {
          const response = await fetch(`${base.replace(/\/$/, '')}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
            body: JSON.stringify({
              queue: 'email',
              name: 'email.send',
              data: mocMariaEmailJob(content, email, 'moc-maria-customer-onboarding', id),
              options: { attempts: 5, jobId: `moc-maria.customer.invite.${id}` },
            }),
            signal: AbortSignal.timeout(5000),
          });
          emailStatus = response.ok ? 'QUEUED' : 'FAILED';
        } catch {
          emailStatus = 'FAILED';
        }
      }
    }
    return {
      customer: { id, displayName, email, phone },
      temporaryPassword,
      mustChangePassword: true,
      emailStatus,
    };
  }
}
