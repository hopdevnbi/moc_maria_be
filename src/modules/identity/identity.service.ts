import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';
import type { RoleName } from './identity.constants';
import { normalizeIdentifier } from './identity-normalization';
import type { AuthUserContext } from './identity.types';

@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
    @InjectRepository(RefreshSession)
    private readonly sessions: Repository<RefreshSession>,
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
  ) {}

  getUserRepository(): Repository<User> {
    return this.users;
  }

  getRoleRepository(): Repository<Role> {
    return this.roles;
  }

  getSessionRepository(): Repository<RefreshSession> {
    return this.sessions;
  }

  async findUserByIdentifier(identifier: string): Promise<User | null> {
    const normalized = normalizeIdentifier(identifier);
    return normalized.includes('@')
      ? this.users.findOne({ where: { email: normalized } })
      : this.users.findOne({ where: { phone: normalized } });
  }

  async findRole(name: RoleName): Promise<Role> {
    const role = await this.roles.findOne({ where: { name } });
    if (!role) {
      throw new Error('Required role is missing from database: ' + name);
    }
    return role;
  }

  async resolveAuthContext(userId: string, sessionId: string): Promise<AuthUserContext> {
    const session = await this.sessions.findOne({
      where: {
        id: sessionId,
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!session) {
      throw new UnauthorizedException('Session is no longer active.');
    }

    const user = await this.users.findOne({
      where: { id: userId },
      relations: {
        userRoles: {
          role: {
            rolePermissions: {
              permission: true,
            },
          },
        },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is unavailable.');
    }

    const roles = user.userRoles.map((userRole) => userRole.role.name);
    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((userRole) =>
          userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code),
        ),
      ),
    ).sort();

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      sessionId,
      roles,
      permissions,
    };
  }

  async writeAudit(input: {
    event: string;
    actorUserId?: string | null;
    targetUserId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditLogs.save(
      this.auditLogs.create({
        event: input.event,
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        metadata: input.metadata ?? {},
      }),
    );
  }
}
