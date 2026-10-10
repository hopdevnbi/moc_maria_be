import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class VipRequestDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class VipReviewDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsString() @Length(3, 500) reason!: string;
}
export class VipSettingsDto {
  @IsOptional() @IsString() @Length(3, 80) displayName?: string;
  @IsOptional() @IsString() @Length(10, 1000) description?: string;
  @IsOptional() @IsBoolean() acceptingRequests?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(3650) durationDays?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) benefits?: string[];
}
export class VipMemberStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: 'ACTIVE' | 'SUSPENDED';
  @IsString() @Length(3, 500) reason!: string;
}
