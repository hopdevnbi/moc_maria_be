import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, FindOptionsWhere, IsNull, MoreThan, Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { Customer } from '../identity/entities/customer.entity';
import { PasswordResetToken } from '../identity/entities/password-reset-token.entity';
import { RefreshSession } from '../identity/entities/refresh-session.entity';
import { Role } from '../identity/entities/role.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { User } from '../identity/entities/user.entity';
import { normalizeEmail, normalizePhone } from '../identity/identity-normalization';
import { IdentityService } from '../identity/identity.service';
import type { AuthResult } from './auth.types';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterCustomerDto } from './dto/register-customer.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';

interface SessionIssue {
  refreshToken: string;
  sessionId: string;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly identityService: IdentityService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(RefreshSession)
    private readonly sessions: Repository<RefreshSession>,
  ) {}

  async registerCustomer(
    dto: RegisterCustomerDto,
    userAgent?: string,
  ): Promise<{ auth: AuthResult; refreshToken: string }> {
    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    if (!email && !phone) {
      throw new BadRequestException('Cần cung cấp email hoặc số điện thoại.');
    }
    this.assertPasswordPolicy(dto.password);

    const passwordHash = await this.hashPassword(dto.password);

    try {
      const issued = await this.dataSource.transaction(async (manager) => {
        const userRepository = manager.getRepository(User);
        const roleRepository = manager.getRepository(Role);
        const customerRepository = manager.getRepository(Customer);
        const userRoleRepository = manager.getRepository(UserRole);

        const existingWhere: FindOptionsWhere<User>[] = [];
        if (email) existingWhere.push({ email });
        if (phone) existingWhere.push({ phone });
        if (existingWhere.length > 0 && (await userRepository.findOne({ where: existingWhere }))) {
          throw new ConflictException('Email hoặc số điện thoại đã được sử dụng.');
        }

        const customerRole = await roleRepository.findOne({ where: { name: 'CUSTOMER' } });
        if (!customerRole) {
          throw new Error('CUSTOMER role has not been seeded.');
        }

        const user = await userRepository.save(
          userRepository.create({
            email,
            phone,
            displayName: dto.displayName.trim(),
            passwordHash,
            isActive: true,
            mustChangePassword: false,
            lastLoginAt: new Date(),
          }),
        );

        await customerRepository.save(
          customerRepository.create({
            userId: user.id,
            birthday: null,
            avatarUrl: null,
            contactPreferences: {},
          }),
        );
        await userRoleRepository.save(
          userRoleRepository.create({
            userId: user.id,
            roleId: customerRole.id,
          }),
        );

        const session = await this.createSession(manager, user.id, userAgent);
        await this.writeAuditWithManager(manager, {
          event: 'AUTH_REGISTER_CUSTOMER',
          actorUserId: user.id,
          targetUserId: user.id,
        });
        return session;
      });

      return {
        auth: await this.buildAuthResult(issued.userId, issued.sessionId),
        refreshToken: issued.refreshToken,
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email hoặc số điện thoại đã được sử dụng.');
      }
      throw error;
    }
  }

  async login(
    dto: LoginDto,
    userAgent?: string,
  ): Promise<{ auth: AuthResult; refreshToken: string }> {
    const user = await this.identityService.findUserByIdentifier(dto.identifier);
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      await this.identityService.writeAudit({
        event: 'AUTH_LOGIN_FAILED',
        targetUserId: user?.id,
        metadata: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Thông tin đăng nhập không chính xác.');
    }
    if (!user.isActive) {
      await this.identityService.writeAudit({
        event: 'AUTH_LOGIN_BLOCKED',
        targetUserId: user.id,
        metadata: { reason: 'account_disabled' },
      });
      throw new UnauthorizedException('Tài khoản hiện không khả dụng.');
    }

    const issued = await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update(user.id, { lastLoginAt: new Date() });
      const session = await this.createSession(manager, user.id, userAgent);
      await this.writeAuditWithManager(manager, {
        event: 'AUTH_LOGIN_SUCCESS',
        actorUserId: user.id,
        targetUserId: user.id,
      });
      return session;
    });

    return {
      auth: await this.buildAuthResult(issued.userId, issued.sessionId),
      refreshToken: issued.refreshToken,
    };
  }

  async refresh(
    rawRefreshToken: string,
    userAgent?: string,
  ): Promise<{ auth: AuthResult; refreshToken: string }> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const issued = await this.dataSource.transaction(async (manager) => {
      const sessionRepository = manager.getRepository(RefreshSession);
      const current = await sessionRepository
        .createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.token_hash = :tokenHash', { tokenHash })
        .getOne();

      if (!current || current.revokedAt || current.expiresAt <= new Date()) {
        throw new UnauthorizedException('Refresh session is invalid or expired.');
      }

      const user = await manager.getRepository(User).findOne({ where: { id: current.userId } });
      if (!user?.isActive) {
        throw new UnauthorizedException('Account is unavailable.');
      }

      const next = await this.createSession(manager, current.userId, userAgent);
      current.revokedAt = new Date();
      current.replacedBySessionId = next.sessionId;
      await sessionRepository.save(current);
      await this.writeAuditWithManager(manager, {
        event: 'AUTH_REFRESH_ROTATED',
        actorUserId: current.userId,
        targetUserId: current.userId,
      });
      return next;
    });

    return {
      auth: await this.buildAuthResult(issued.userId, issued.sessionId),
      refreshToken: issued.refreshToken,
    };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const session = await this.sessions.findOne({
      where: { tokenHash: this.hashToken(rawRefreshToken) },
    });
    if (!session || session.revokedAt) return;

    session.revokedAt = new Date();
    await this.sessions.save(session);
    await this.identityService.writeAudit({
      event: 'AUTH_LOGOUT',
      actorUserId: session.userId,
      targetUserId: session.userId,
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessions.update(
      { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { revokedAt: new Date() },
    );
    await this.identityService.writeAudit({
      event: 'AUTH_LOGOUT_ALL',
      actorUserId: userId,
      targetUserId: userId,
    });
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<{ accepted: true; debugResetToken?: string }> {
    const user = await this.identityService.findUserByIdentifier(dto.identifier);
    if (!user?.isActive) {
      return { accepted: true };
    }

    const rawToken = randomBytes(40).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.config.getPasswordResetTtlMinutes() * 60 * 1000);

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PasswordResetToken);
      await repository.update({ userId: user.id, usedAt: IsNull() }, { usedAt: new Date() });
      await repository.save(
        repository.create({
          userId: user.id,
          tokenHash,
          expiresAt,
          usedAt: null,
        }),
      );
      await this.writeAuditWithManager(manager, {
        event: 'AUTH_PASSWORD_RESET_REQUESTED',
        targetUserId: user.id,
      });
    });

    return this.config.getNodeEnv() === 'production'
      ? { accepted: true }
      : { accepted: true, debugResetToken: rawToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    this.assertPasswordPolicy(dto.newPassword);
    const newHash = await this.hashPassword(dto.newPassword);
    const tokenHash = this.hashToken(dto.token);

    await this.dataSource.transaction(async (manager) => {
      const resetRepository = manager.getRepository(PasswordResetToken);
      const token = await resetRepository
        .createQueryBuilder('token')
        .setLock('pessimistic_write')
        .where('token.token_hash = :tokenHash', { tokenHash })
        .getOne();

      if (!token || token.usedAt || token.expiresAt <= new Date()) {
        throw new BadRequestException('Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
      }

      const user = await manager.getRepository(User).findOne({ where: { id: token.userId } });
      if (!user?.isActive) {
        throw new BadRequestException('Tài khoản hiện không khả dụng.');
      }

      user.passwordHash = newHash;
      user.mustChangePassword = false;
      await manager.getRepository(User).save(user);

      token.usedAt = new Date();
      await resetRepository.save(token);
      await manager
        .getRepository(RefreshSession)
        .update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: new Date() });

      await this.writeAuditWithManager(manager, {
        event: 'AUTH_PASSWORD_RESET_COMPLETED',
        actorUserId: user.id,
        targetUserId: user.id,
      });
    });
  }

  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto): Promise<void> {
    this.assertPasswordPolicy(dto.newPassword);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Mật khẩu hiện tại không chính xác.');
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    user.mustChangePassword = false;
    await this.users.save(user);

    await this.sessions
      .createQueryBuilder()
      .update(RefreshSession)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('id != :sessionId', { sessionId })
      .andWhere('revoked_at IS NULL')
      .execute();

    await this.identityService.writeAudit({
      event: 'AUTH_PASSWORD_CHANGED',
      actorUserId: userId,
      targetUserId: userId,
    });
  }

  private async buildAuthResult(userId: string, sessionId: string): Promise<AuthResult> {
    const user = await this.identityService.resolveAuthContext(userId, sessionId);
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, sid: sessionId },
      { expiresIn: this.config.getJwtAccessTtlSeconds() },
    );
    return { accessToken, user };
  }

  private async createSession(
    manager: EntityManager,
    userId: string,
    userAgent?: string,
  ): Promise<SessionIssue> {
    const rawToken = randomBytes(48).toString('base64url');
    const repository = manager.getRepository(RefreshSession);
    const session = await repository.save(
      repository.create({
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(
          Date.now() + this.config.getRefreshSessionTtlDays() * 24 * 60 * 60 * 1000,
        ),
        revokedAt: null,
        replacedBySessionId: null,
        userAgent: userAgent?.slice(0, 500) ?? null,
      }),
    );
    return { refreshToken: rawToken, sessionId: session.id, userId };
  }

  private async writeAuditWithManager(
    manager: EntityManager,
    input: {
      event: string;
      actorUserId?: string | null;
      targetUserId?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const repository = manager.getRepository(AuditLog);
    await repository.save(
      repository.create({
        event: input.event,
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        metadata: input.metadata ?? {},
      }),
    );
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
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
