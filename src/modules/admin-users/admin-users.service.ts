import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { DataSource, FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { RefreshSession } from '../identity/entities/refresh-session.entity';
import { Role } from '../identity/entities/role.entity';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { User } from '../identity/entities/user.entity';
import { normalizeEmail, normalizePhone } from '../identity/identity-normalization';
import { IdentityService } from '../identity/identity.service';
import type { AuthUserContext } from '../identity/identity.types';
import type { RoleName } from '../identity/identity.constants';
import type { AssignRolesDto } from './dto/assign-roles.dto';
import type { CreateStaffDto } from './dto/create-staff.dto';
interface StaffUserView {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: RoleName[];
  staff: {
    id: string;
    publicName: string;
    isActive: boolean;
    isPublic: boolean;
    avatarUrl: string | null;
    bio: string | null;
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly identityService: IdentityService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
    @InjectRepository(StaffProfile)
    private readonly staffProfiles: Repository<StaffProfile>,
    @InjectRepository(RefreshSession)
    private readonly sessions: Repository<RefreshSession>,
  ) {}

  async createStaff(actor: AuthUserContext, dto: CreateStaffDto): Promise<StaffUserView> {
    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    if (!email && !phone) {
      throw new BadRequestException('Cần cung cấp email hoặc số điện thoại cho nhân viên.');
    }
    this.assertPasswordPolicy(dto.password);
    const passwordHash = await this.hashPassword(dto.password);

    try {
      const userId = await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);
        const roles = manager.getRepository(Role);
        const staffProfiles = manager.getRepository(StaffProfile);
        const userRoles = manager.getRepository(UserRole);

        const where: FindOptionsWhere<User>[] = [];
        if (email) where.push({ email });
        if (phone) where.push({ phone });
        if (where.length > 0 && (await users.findOne({ where }))) {
          throw new ConflictException('Email hoặc số điện thoại đã được sử dụng.');
        }

        const role = await roles.findOne({ where: { name: dto.role } });
        if (!role) throw new Error('Role seed is missing: ' + dto.role);

        const user = await users.save(
          users.create({
            email,
            phone,
            displayName: dto.displayName.trim(),
            passwordHash,
            isActive: true,
            mustChangePassword: true,
            lastLoginAt: null,
          }),
        );

        await staffProfiles.save(
          staffProfiles.create({
            userId: user.id,
            publicName: dto.publicName.trim(),
            isActive: true,
            isPublic: dto.isPublic ?? true,
            avatarUrl: null,
            bio: null,
          }),
        );

        await userRoles.save(userRoles.create({ userId: user.id, roleId: role.id }));
        await manager.getRepository(AuditLog).insert({
          event: 'ADMIN_STAFF_CREATED',
          actorUserId: actor.id,
          targetUserId: user.id,
          metadata: { role: dto.role },
        });
        return user.id;
      });

      return this.getStaffUser(userId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email hoặc số điện thoại đã được sử dụng.');
      }
      throw error;
    }
  }

  async assignRoles(
    actor: AuthUserContext,
    userId: string,
    dto: AssignRolesDto,
  ): Promise<StaffUserView> {
    const target = await this.getStaffUser(userId);
    if (target.roles.includes('SUPER_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Chỉ SUPER_ADMIN có thể thay đổi SUPER_ADMIN.');
    }

    const uniqueRoles = Array.from(new Set(dto.roles));
    await this.dataSource.transaction(async (manager) => {
      const roles = await manager.getRepository(Role).find({
        where: uniqueRoles.map((name) => ({ name })),
      });
      if (roles.length !== uniqueRoles.length) {
        throw new BadRequestException('Có role không hợp lệ.');
      }
      await manager.getRepository(UserRole).delete({ userId });
      await manager
        .getRepository(UserRole)
        .insert(roles.map((role) => ({ userId, roleId: role.id })));
      await manager.getRepository(AuditLog).insert({
        event: 'ADMIN_ROLES_CHANGED',
        actorUserId: actor.id,
        targetUserId: userId,
        metadata: { roles: uniqueRoles },
      });
    });

    return this.getStaffUser(userId);
  }

  async setActive(
    actor: AuthUserContext,
    userId: string,
    isActive: boolean,
  ): Promise<{ id: string; isActive: boolean }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản.');
    await this.assertSuperAdminTargetAccess(actor, userId);
    if (actor.id === userId && !isActive) {
      throw new BadRequestException('Không thể tự vô hiệu hóa tài khoản đang sử dụng.');
    }

    user.isActive = isActive;
    await this.users.save(user);
    const staff = await this.staffProfiles.findOne({ where: { userId } });
    if (staff) {
      staff.isActive = isActive;
      await this.staffProfiles.save(staff);
    }
    if (!isActive) {
      await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    }
    await this.identityService.writeAudit({
      event: isActive ? 'ADMIN_ACCOUNT_ENABLED' : 'ADMIN_ACCOUNT_DISABLED',
      actorUserId: actor.id,
      targetUserId: userId,
    });
    return { id: userId, isActive };
  }

  async resetPassword(
    actor: AuthUserContext,
    userId: string,
  ): Promise<{ temporaryPassword: string; mustChangePassword: true }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản.');
    await this.assertSuperAdminTargetAccess(actor, userId);

    const temporaryPassword = 'Mm9-' + randomBytes(9).toString('base64url');
    user.passwordHash = await this.hashPassword(temporaryPassword);
    user.mustChangePassword = true;
    await this.users.save(user);
    await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.identityService.writeAudit({
      event: 'ADMIN_PASSWORD_RESET',
      actorUserId: actor.id,
      targetUserId: userId,
    });
    return { temporaryPassword, mustChangePassword: true };
  }

  async listRoles(): Promise<Array<{ name: RoleName; description: string | null }>> {
    const roles = await this.roles.find({ order: { name: 'ASC' } });
    return roles.map((role) => ({ name: role.name, description: role.description }));
  }

  async getStaffUser(userId: string): Promise<StaffUserView> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { userRoles: { role: true }, staffProfile: true },
    });
    if (!user || !user.staffProfile) {
      throw new NotFoundException('Không tìm thấy nhân viên.');
    }
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      roles: user.userRoles.map((item) => item.role.name).sort(),
      staff: {
        id: user.staffProfile.id,
        publicName: user.staffProfile.publicName,
        isActive: user.staffProfile.isActive,
        isPublic: user.staffProfile.isPublic,
        avatarUrl: user.staffProfile.avatarUrl,
        bio: user.staffProfile.bio,
      },
    };
  }

  private async assertSuperAdminTargetAccess(
    actor: AuthUserContext,
    userId: string,
  ): Promise<void> {
    if (actor.roles.includes('SUPER_ADMIN')) return;
    const superAdminRole = await this.roles.findOne({ where: { name: 'SUPER_ADMIN' } });
    if (!superAdminRole) return;
    const assignment = await this.dataSource.getRepository(UserRole).findOne({
      where: { userId, roleId: superAdminRole.id },
    });
    if (assignment) {
      throw new ForbiddenException('Chỉ SUPER_ADMIN có thể quản lý tài khoản SUPER_ADMIN.');
    }
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private assertPasswordPolicy(password: string): void {
    if (
      password.length < 10 ||
      password.length > 128 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw new BadRequestException(
        'Mật khẩu phải dài 10-128 ký tự và có chữ hoa, chữ thường, chữ số.',
      );
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      String((error as { code?: unknown }).code) === '23505'
    );
  }
}
