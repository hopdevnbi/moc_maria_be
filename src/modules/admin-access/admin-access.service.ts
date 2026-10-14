import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { normalizeEmail, normalizePhone } from '../identity/identity-normalization';
import {
  type AccessUsersQueryDto,
  type ManagedRole,
  type ProvisionUserDto,
  type RoleChangeDto,
} from './admin-access.dto';

export type Account = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  roles: ManagedRole[];
  isStaff: boolean;
  hasCustomerProfile: boolean;
};

export interface AccountPage {
  items: Account[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  counts: { all: number; active: number; superAdmins: number; staff: number };
}

export type ManagedRoleRecord = {
  name: ManagedRole;
  description: string | null;
  permissions: string[];
  users: number;
};

export type RoleAudit = {
  event: string;
  createdAt: Date;
  actorName: string | null;
  metadata: Record<string, unknown>;
};

const accountFrom = `FROM users u
 LEFT JOIN staff_profiles s ON s.user_id=u.id
 LEFT JOIN customers c ON c.user_id=u.id`;

const accountFields = `u.id, u.display_name AS "displayName",u.email,u.phone,
 u.is_active AS "isActive",u.created_at AS "createdAt",u.last_login_at AS "lastLoginAt",
 s.id IS NOT NULL AS "isStaff",c.id IS NOT NULL AS "hasCustomerProfile",
 COALESCE((SELECT array_agg(r.name ORDER BY r.name)
   FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id),
   ARRAY[]::varchar[]) AS roles`;

const SUPER_LOCK =
  "SELECT pg_advisory_xact_lock(hashtextextended('mocmaria:super-admin-grants',0))";

@Injectable()
export class AdminAccessService {
  constructor(private readonly db: DataSource) {}

  private authorize(actor: AuthUserContext): void {
    if (!actor.roles.includes('SUPER_ADMIN') || !actor.permissions.includes('roles.manage')) {
      throw new ForbiddenException('Chỉ Super Admin được quản lý phân quyền hệ thống.');
    }
  }

  async roles(actor: AuthUserContext): Promise<ManagedRoleRecord[]> {
    this.authorize(actor);
    return this.db.query<ManagedRoleRecord[]>(
      `SELECT r.name,r.description,
       COALESCE((SELECT array_agg(p.code ORDER BY p.code) FROM role_permissions rp
         JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id),ARRAY[]::varchar[]) AS permissions,
       (SELECT COUNT(*)::int FROM user_roles ur WHERE ur.role_id=r.id) AS users
       FROM roles r ORDER BY CASE r.name
       WHEN 'SUPER_ADMIN' THEN 1 WHEN 'ADMIN' THEN 2 WHEN 'BRANCH_MANAGER' THEN 3
       WHEN 'RECEPTIONIST' THEN 4 WHEN 'THERAPIST' THEN 5
       WHEN 'DOCTOR_CONSULTANT' THEN 6 ELSE 7 END`,
    );
  }

  async users(actor: AuthUserContext, query: AccessUsersQueryDto): Promise<AccountPage> {
    this.authorize(actor);
    const q = query.q?.trim() || null;
    const role = query.role || 'ALL';
    const status = query.status || 'ALL';
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [counts] = await this.db.query<
      Array<{ all: number; active: number; superAdmins: number; staff: number }>
    >(
      `SELECT COUNT(*)::int AS "all",COUNT(*) FILTER(WHERE u.is_active)::int AS active,
       COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM user_roles ur JOIN roles r
           ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='SUPER_ADMIN'))::int AS "superAdmins",
       COUNT(*) FILTER(WHERE s.id IS NOT NULL)::int AS staff ${accountFrom}`,
    );
    const filter = `WHERE ($1::text IS NULL OR
      POSITION(lower($1::text) IN lower(u.display_name))>0 OR
      POSITION(lower($1::text) IN lower(COALESCE(u.email,'')))>0 OR
      POSITION(lower($1::text) IN lower(COALESCE(u.phone,'')))>0)
      AND ($2::text='ALL' OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=u.id AND r.name=$2::text))
      AND ($3::text='ALL' OR ($3::text='ACTIVE' AND u.is_active)
        OR ($3::text='INACTIVE' AND NOT u.is_active))`;
    const [totalRow] = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS total ${accountFrom} ${filter}`,
      [q, role, status],
    );
    const items = await this.db.query<Account[]>(
      `SELECT ${accountFields} ${accountFrom} ${filter}
       ORDER BY u.created_at DESC,u.id DESC LIMIT $4::int OFFSET $5::int`,
      [q, role, status, limit, (page - 1) * limit],
    );
    const total = Number(totalRow.total);
    return {
      items,
      page,
      limit,
      total,
      hasMore: page * limit < total,
      counts: {
        all: Number(counts.all),
        active: Number(counts.active),
        superAdmins: Number(counts.superAdmins),
        staff: Number(counts.staff),
      },
    };
  }

  async history(actor: AuthUserContext, id: string): Promise<RoleAudit[]> {
    this.authorize(actor);
    const [user] = await this.db.query<Array<{ id: string }>>(
      'SELECT id FROM users WHERE id=$1::uuid',
      [id],
    );
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản.');
    return this.db.query<RoleAudit[]>(
      `SELECT a.event,a.created_at AS "createdAt",u.display_name AS "actorName",a.metadata
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
       WHERE a.target_user_id=$1::uuid AND a.event IN
         ('ACCESS_ROLE_CHANGED','ACCESS_ACCOUNT_CREATED','ADMIN_ROLES_CHANGED',
          'ADMIN_STAFF_CREATED','ADMIN_ACCOUNT_ENABLED','ADMIN_ACCOUNT_DISABLED')
       ORDER BY a.created_at DESC LIMIT 30`,
      [id],
    );
  }

  private async ensureSensitiveApproval(
    manager: EntityManager,
    actor: AuthUserContext,
    currentPassword?: string,
    confirmation?: string,
  ): Promise<void> {
    if (confirmation !== 'CONFIRM_SUPER_ADMIN' || !currentPassword) {
      throw new BadRequestException(
        'Cần xác nhận nâng quyền và nhập mật khẩu Super Admin hiện tại.',
      );
    }
    const [record] = await manager.query<Array<{ password_hash: string }>>(
      'SELECT password_hash FROM users WHERE id=$1::uuid AND is_active=true',
      [actor.id],
    );
    if (!record || !(await argon2.verify(record.password_hash, currentPassword))) {
      throw new ForbiddenException('Mật khẩu quản trị không chính xác.');
    }
  }

  async changeRole(actor: AuthUserContext, userId: string, dto: RoleChangeDto): Promise<Account> {
    this.authorize(actor);
    if (actor.id === userId) {
      throw new ForbiddenException('Không thể tự thay đổi vai trò đang sử dụng.');
    }
    const reason = dto.reason.trim();
    if (reason.length < 10 || reason.length > 500)
      throw new BadRequestException('Lý do phân quyền phải từ 10 đến 500 ký tự.');

    await this.db.transaction(async (manager) => {
      // All admin role changes serialize, preventing concurrent removal of the last Super Admin.
      await manager.query(SUPER_LOCK);
      const [target] = await manager.query<Array<{ id: string; has_customer: boolean }>>(
        `SELECT u.id,EXISTS(SELECT 1 FROM customers c WHERE c.user_id=u.id) AS has_customer
         FROM users u WHERE u.id=$1::uuid FOR UPDATE`,
        [userId],
      );
      if (!target) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (dto.role === 'CUSTOMER' && !target.has_customer) {
        throw new BadRequestException(
          'Tài khoản này chưa có hồ sơ khách hàng để chuyển về Customer.',
        );
      }
      const previous = await manager.query<Array<{ name: ManagedRole }>>(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id
         WHERE ur.user_id=$1::uuid ORDER BY r.name`,
        [userId],
      );
      const before = previous.map((item) => item.name);
      const after: ManagedRole[] =
        target.has_customer && dto.role !== 'CUSTOMER' ? [dto.role, 'CUSTOMER'] : [dto.role];
      if (before.length === after.length && before.every((role) => after.includes(role))) return;
      if (before.includes('SUPER_ADMIN') || dto.role === 'SUPER_ADMIN') {
        await this.ensureSensitiveApproval(manager, actor, dto.currentPassword, dto.confirmation);
      }
      if (before.includes('SUPER_ADMIN') && !after.includes('SUPER_ADMIN')) {
        const [row] = await manager.query<Array<{ count: number }>>(
          `SELECT COUNT(*)::int AS count FROM user_roles ur JOIN roles r ON r.id=ur.role_id
           WHERE r.name='SUPER_ADMIN'`,
        );
        if (Number(row.count) <= 1) {
          throw new ConflictException('Phải giữ ít nhất một tài khoản Super Admin.');
        }
      }
      const roles = await manager.query<Array<{ id: string; name: ManagedRole }>>(
        'SELECT id,name FROM roles WHERE name=ANY($1::varchar[])',
        [after],
      );
      if (roles.length !== after.length)
        throw new ConflictException('Dữ liệu vai trò chưa được cấu hình.');
      if (dto.role !== 'CUSTOMER') {
        // A customer promoted to a staff role must also have the profile used by /staff/me.
        // Never publish a KTV profile simply because the account was assigned THERAPIST.
        await manager.query(
          `INSERT INTO staff_profiles(user_id,public_name,is_active,is_public)
           SELECT id,display_name,is_active,false FROM users WHERE id=$1::uuid
           ON CONFLICT(user_id) DO NOTHING`,
          [userId],
        );
      }
      await manager.query('DELETE FROM user_roles WHERE user_id=$1::uuid', [userId]);
      for (const role of roles) {
        await manager.query('INSERT INTO user_roles(user_id,role_id) VALUES($1::uuid,$2::uuid)', [
          userId,
          role.id,
        ]);
      }
      await manager.query(
        'UPDATE refresh_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL',
        [userId],
      );
      await manager.query(
        `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata)
         VALUES('ACCESS_ROLE_CHANGED',$1::uuid,$2::uuid,$3::jsonb)`,
        [actor.id, userId, JSON.stringify({ before, after, reason })],
      );
    });
    const [updated] = await this.db.query<Account[]>(
      `SELECT ${accountFields} ${accountFrom} WHERE u.id=$1::uuid`,
      [userId],
    );
    return updated;
  }

  async setStatus(
    actor: AuthUserContext,
    userId: string,
    isActive: boolean,
    approval: { currentPassword?: string; confirmation?: string } = {},
  ): Promise<{ id: string; isActive: boolean }> {
    this.authorize(actor);
    if (actor.id === userId) {
      throw new ForbiddenException('Không thể tự khóa hoặc mở lại tài khoản đang sử dụng.');
    }
    await this.db.transaction(async (manager) => {
      await manager.query(SUPER_LOCK);
      const [user] = await manager.query<Array<{ id: string; is_active: boolean }>>(
        'SELECT id,is_active FROM users WHERE id=$1::uuid FOR UPDATE',
        [userId],
      );
      if (!user) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (user.is_active === isActive) return;
      const [summary] = await manager.query<Array<{ is_super: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
         WHERE ur.user_id=$1::uuid AND r.name='SUPER_ADMIN') AS is_super`,
        [userId],
      );
      if (!isActive && summary.is_super) {
        await this.ensureSensitiveApproval(
          manager,
          actor,
          approval.currentPassword,
          approval.confirmation,
        );
        const [count] = await manager.query<Array<{ total: number }>>(
          `SELECT COUNT(*)::int AS total FROM users u
           JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
           WHERE r.name='SUPER_ADMIN' AND u.is_active=true`,
        );
        if (Number(count.total) <= 1)
          throw new ConflictException('Không thể khóa Super Admin đang hoạt động cuối cùng.');
      }
      await manager.query('UPDATE users SET is_active=$2,updated_at=NOW() WHERE id=$1::uuid', [
        userId,
        isActive,
      ]);
      await manager.query(
        'UPDATE staff_profiles SET is_active=$2,updated_at=NOW() WHERE user_id=$1::uuid',
        [userId, isActive],
      );
      if (!isActive)
        await manager.query(
          'UPDATE refresh_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL',
          [userId],
        );
      await manager.query(
        `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata)
         VALUES($1,$2::uuid,$3::uuid,$4::jsonb)`,
        [
          isActive ? 'ADMIN_ACCOUNT_ENABLED' : 'ADMIN_ACCOUNT_DISABLED',
          actor.id,
          userId,
          JSON.stringify({ source: 'admin_access' }),
        ],
      );
    });
    return { id: userId, isActive };
  }

  async create(
    actor: AuthUserContext,
    dto: ProvisionUserDto,
  ): Promise<{
    account: Account;
    temporaryPassword: string;
  }> {
    this.authorize(actor);
    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    if (!email && !phone) throw new BadRequestException('Cần email hoặc số điện thoại đăng nhập.');
    const displayName = dto.displayName.trim();
    if (displayName.length < 2) throw new BadRequestException('Tên hiển thị cần ít nhất 2 ký tự.');
    const temporaryPassword = 'Mm9-' + randomBytes(14).toString('base64url');
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    let id: string;
    try {
      id = await this.db.transaction(async (manager) => {
        const role = (
          await manager.query<Array<{ id: string }>>('SELECT id FROM roles WHERE name=$1', [
            dto.role,
          ])
        )[0];
        if (!role) throw new ConflictException('Vai trò chưa được cấu hình.');
        if (dto.role === 'SUPER_ADMIN') {
          await this.ensureSensitiveApproval(manager, actor, dto.currentPassword, dto.confirmation);
        }
        const [created] = await manager.query<Array<{ id: string }>>(
          `INSERT INTO users(email,phone,display_name,password_hash,is_active,must_change_password)
           VALUES($1,$2,$3,$4,true,true) RETURNING id`,
          [email, phone, displayName, passwordHash],
        );
        await manager.query(
          `INSERT INTO staff_profiles(user_id,public_name,is_active,is_public)
           VALUES($1::uuid,$2,true,false)`,
          [created.id, displayName],
        );
        await manager.query('INSERT INTO user_roles(user_id,role_id) VALUES($1::uuid,$2::uuid)', [
          created.id,
          role.id,
        ]);
        await manager.query(
          `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata)
           VALUES('ACCESS_ACCOUNT_CREATED',$1::uuid,$2::uuid,$3::jsonb)`,
          [actor.id, created.id, JSON.stringify({ role: dto.role, provisionedBySuperAdmin: true })],
        );
        return created.id;
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException('Email hoặc số điện thoại đã được sử dụng.');
      }
      throw error;
    }
    const [account] = await this.db.query<Account[]>(
      `SELECT ${accountFields} ${accountFrom} WHERE u.id=$1::uuid`,
      [id],
    );
    return { account, temporaryPassword };
  }
}
