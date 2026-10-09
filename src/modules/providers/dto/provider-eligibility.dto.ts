import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProviderOperationReasonDto } from './provider-schedule.dto';

export class SaveProviderPublicProfileDto extends ProviderOperationReasonDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(120) slug!: string;
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) yearsExperience?: number;
  @IsBoolean() isPublished!: boolean;
  @Equals(true) accuracyConfirmed!: boolean;
}
export class SaveProviderOperatingReviewDto extends ProviderOperationReasonDto {
  @IsIn(['WELLNESS', 'SPECIALIST']) providerKind!: 'WELLNESS' | 'SPECIALIST';
  @IsIn(['ACTIVE', 'WATCHLIST', 'PAUSED', 'SUSPENDED']) qualityStatus!:
    'ACTIVE' | 'WATCHLIST' | 'PAUSED' | 'SUSPENDED';
}
export class SaveServiceProviderPolicyDto extends ProviderOperationReasonDto {
  @IsUUID() serviceId!: string;
  @IsUUID() branchId!: string;
  @IsUUID() courseId!: string;
  @IsIn(['ON_SITE', 'AT_HOME']) mode!: 'ON_SITE' | 'AT_HOME';
  @IsString() @Matches(/^[A-Z0-9_-]{2,64}$/) jurisdictionCode!: string;
  @IsString() @MinLength(2) @MaxLength(120) territoryLabel!: string;
  @IsIn(['LICENSE_REQUIRED', 'NOT_REQUIRED']) legalRequirement!:
    'LICENSE_REQUIRED' | 'NOT_REQUIRED';
  @IsString() @Matches(/^[A-Za-z0-9_-]{3,100}$/) legalReviewReference!: string;
  @IsISO8601({ strict: true }) validUntil!: string;
  @IsBoolean() isActive!: boolean;
  @Equals(true) legalReviewConfirmed!: boolean;
}
export class SaveProviderServiceGrantDto extends ProviderOperationReasonDto {
  @IsUUID() policyId!: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,100}$/) credentialReference?: string;
  @IsOptional() @IsISO8601({ strict: true }) credentialValidUntil?: string;
  @IsInt() @Min(0) @Max(240) travelBufferMinutes!: number;
  @IsInt() @Min(0) @Max(100000000) travelFeeVnd!: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) maxRadiusKm?: number;
  @IsBoolean() isActive!: boolean;
  @Equals(true) conditionsConfirmed!: boolean;
}
