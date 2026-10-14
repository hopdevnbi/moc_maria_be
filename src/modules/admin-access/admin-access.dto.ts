import { Type } from 'class-transformer';
import {
  IsEmail,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const MANAGED_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'BRANCH_MANAGER',
  'RECEPTIONIST',
  'THERAPIST',
  'DOCTOR_CONSULTANT',
  'CUSTOMER',
] as const;

export type ManagedRole = (typeof MANAGED_ROLES)[number];

export class AccessUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(['ALL', ...MANAGED_ROLES])
  role?: 'ALL' | ManagedRole;

  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'INACTIVE'])
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class RoleChangeDto {
  @IsIn(MANAGED_ROLES)
  role!: ManagedRole;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @IsOptional()
  @IsIn(['CONFIRM_SUPER_ADMIN'])
  confirmation?: 'CONFIRM_SUPER_ADMIN';
}

export class ProvisionUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @ValidateIf((dto: ProvisionUserDto) => !!dto.email)
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsIn(MANAGED_ROLES.filter((role) => role !== 'CUSTOMER'))
  role!: Exclude<ManagedRole, 'CUSTOMER'>;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @IsOptional()
  @IsIn(['CONFIRM_SUPER_ADMIN'])
  confirmation?: 'CONFIRM_SUPER_ADMIN';
}

export class AccessStatusDto {
  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @IsOptional()
  @IsIn(['CONFIRM_SUPER_ADMIN'])
  confirmation?: 'CONFIRM_SUPER_ADMIN';
}
