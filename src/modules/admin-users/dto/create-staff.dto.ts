import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { RoleName } from '../../identity/identity.constants';

const STAFF_PROVISION_ROLES = [
  'ADMIN',
  'BRANCH_MANAGER',
  'RECEPTIONIST',
  'THERAPIST',
  'DOCTOR_CONSULTANT',
] as const satisfies readonly RoleName[];

export class CreateStaffDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  publicName!: string;

  @ValidateIf((value: CreateStaffDto) => Boolean(value.email))
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;

  @IsIn(STAFF_PROVISION_ROLES)
  role!: (typeof STAFF_PROVISION_ROLES)[number];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
