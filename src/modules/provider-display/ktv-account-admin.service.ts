import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { normalizeEmail, normalizePhone } from '../identity/identity-normalization';
import type { AuthUserContext } from '../identity/identity.types';
import type { UpdateKtvAccountDto } from './update-ktv-account.dto';

export interface KtvAccountAdminView {
  providerId: string;
  userId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
}

type AccountRow = KtvAccountAdminView & { isTherapist: boolean; isSuperAdmin: boolean };

@Injectable()
export class KtvAccountAdminService {
  constructor(private readonly db: DataSource) {}

  private requireSuperAdmin(actor: AuthUserContext): void {
    if (!actor.roles.includes('SUPER_ADMIN') || !actor.permissions.includes('staff.manage')) {
      throw new ForbiddenException('Chỉ Super Admin được quản lý đăng nhập KTV.');
    }
  }

  private accountQuery(forUpdate = false): string {
    return `SELECT p.id AS "providerId",u.id AS "userId",u.display_name AS "displayName",
      u.email,u.phone,u.is_active AS "isActive",u.must_change_password AS "mustChangePassword",
      EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=u.id AND r.name='THERAPIST') AS "isTherapist",
      EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=u.id AND r.name='SUPER_ADMIN') AS "isSuperAdmin"
      FROM provider_applications p JOIN users u ON u.id=p.user_id
      WHERE p.id=$1${forUpdate ? ' FOR UPDATE OF u' : ''}`;
  }

  private cleanAccount(row: AccountRow): KtvAccountAdminView {
    const { providerId, userId, displayName, email, phone, isActive, mustChangePassword } = row;
    return { providerId, userId, displayName, email, phone, isActive, mustChangePassword };
  }

  private assertTherapist(account: AccountRow | undefined): asserts account is AccountRow {
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản KTV.');
    if (!account.isTherapist || account.isSuperAdmin)
      throw new ForbiddenException('Chỉ được sửa tài khoản kỹ thuật viên, không sửa Super Admin.');
  }

  async get(actor: AuthUserContext, providerId: string): Promise<KtvAccountAdminView> {
    this.requireSuperAdmin(actor);
    const [account] = await this.db.query<AccountRow[]>(this.accountQuery(), [providerId]);
    this.assertTherapist(account);
    return this.cleanAccount(account);
  }

  async update(
    actor: AuthUserContext,
    providerId: string,
    dto: UpdateKtvAccountDto,
  ): Promise<KtvAccountAdminView> {
    this.requireSuperAdmin(actor);
    if (dto.password === null || dto.email === null || dto.displayName === null)
      throw new BadRequestException('Không được để trống email, tên hoặc mật khẩu.');
    if (dto.mustChangePassword !== undefined && dto.password === undefined)
      throw new BadRequestException('Chỉ chọn đổi mật khẩu bắt buộc khi đặt mật khẩu mới.');
    if (
      dto.password !== undefined &&
      (dto.password.length < 10 ||
        dto.password.length > 128 ||
        !/[a-z]/.test(dto.password) ||
        !/[A-Z]/.test(dto.password) ||
        !/\d/.test(dto.password))
    )
      throw new BadRequestException('Mật khẩu cần 10-128 ký tự, chữ hoa, chữ thường và chữ số.');
    const nextEmail = dto.email === undefined ? undefined : normalizeEmail(dto.email);
    const nextPhone = dto.phone === undefined ? undefined : normalizePhone(dto.phone);
    const nextName = dto.displayName?.trim();
    if (dto.email !== undefined && !nextEmail)
      throw new BadRequestException('Email đăng nhập không hợp lệ.');
    if (dto.displayName !== undefined && (!nextName || nextName.length < 2))
      throw new BadRequestException('Tên tài khoản phải có ít nhất 2 ký tự.');

    // Hash outside the transaction so a password change does not hold a row lock
    // during Argon2 work. Never log or persist the cleartext password.
    const passwordHash =
      dto.password === undefined
        ? undefined
        : await argon2.hash(dto.password, {
            type: argon2.argon2id,
            memoryCost: 19456,
            timeCost: 2,
            parallelism: 1,
          });
    try {
      return await this.db.transaction(async (manager) => {
        const [current] = await manager.query<AccountRow[]>(this.accountQuery(true), [providerId]);
        this.assertTherapist(current);
        const email = nextEmail === undefined ? current.email : nextEmail;
        const phone = nextPhone === undefined ? current.phone : nextPhone;
        const displayName = nextName === undefined ? current.displayName : nextName;
        if (!email && !phone)
          throw new BadRequestException('Tài khoản phải có email hoặc số điện thoại.');
        const fields = [
          ...(email !== current.email ? ['email'] : []),
          ...(phone !== current.phone ? ['phone'] : []),
          ...(displayName !== current.displayName ? ['displayName'] : []),
          ...(passwordHash ? ['password'] : []),
        ];
        if (fields.length === 0) throw new BadRequestException('Không có thay đổi nào để lưu.');
        if (email !== current.email && email) {
          const collision = await manager.query<{ id: string }[]>(
            'SELECT id FROM users WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1',
            [email, current.userId],
          );
          if (collision.length)
            throw new ConflictException('Email này đã được tài khoản khác sử dụng.');
        }
        if (phone !== current.phone && phone) {
          const collision = await manager.query<{ id: string }[]>(
            'SELECT id FROM users WHERE phone=$1 AND id<>$2 LIMIT 1',
            [phone, current.userId],
          );
          if (collision.length) throw new ConflictException('Số điện thoại đã được sử dụng.');
        }
        const nextMustChange = passwordHash
          ? (dto.mustChangePassword ?? false)
          : current.mustChangePassword;
        await manager.query(
          `UPDATE users SET email=$2,phone=$3,display_name=$4,
           password_hash=COALESCE($5,password_hash),must_change_password=$6,updated_at=now()
           WHERE id=$1`,
          [current.userId, email, phone, displayName, passwordHash ?? null, nextMustChange],
        );
        // Credential changes invalidate all existing devices. Name-only edits do not.
        if (fields.some((field) => ['email', 'phone', 'password'].includes(field))) {
          await manager.query(
            'UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
            [current.userId],
          );
        }
        await manager.query(
          `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata)
           VALUES($1,$2,$3,$4::jsonb)`,
          [
            'ADMIN_KTV_ACCOUNT_UPDATED',
            actor.id,
            current.userId,
            JSON.stringify({ providerId, fields }),
          ],
        );
        return {
          ...this.cleanAccount(current),
          email,
          phone,
          displayName,
          mustChangePassword: nextMustChange,
        };
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('Email hoặc số điện thoại đã được sử dụng.');
      }
      throw error;
    }
  }
}
