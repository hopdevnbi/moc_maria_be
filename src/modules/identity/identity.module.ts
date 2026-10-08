import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { Customer } from './entities/customer.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Permission } from './entities/permission.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from './entities/role.entity';
import { StaffProfile } from './entities/staff-profile.entity';
import { UserRole } from './entities/user-role.entity';
import { User } from './entities/user.entity';
import { IdentityService } from './identity.service';

const entities = [
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  RefreshSession,
  PasswordResetToken,
  Customer,
  StaffProfile,
  AuditLog,
];

@Module({
  imports: [TypeOrmModule.forFeature(entities)],
  providers: [IdentityService],
  exports: [TypeOrmModule, IdentityService],
})
export class IdentityModule {}
