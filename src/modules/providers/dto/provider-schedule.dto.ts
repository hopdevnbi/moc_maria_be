import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ProviderOperationReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
export class AssignProviderSkillDto extends ProviderOperationReasonDto {
  @IsUUID() serviceId!: string;
  @IsUUID() certificateId!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class AssignProviderBranchDto extends ProviderOperationReasonDto {
  @IsUUID() branchId!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class AddProviderWeeklyShiftDto extends ProviderOperationReasonDto {
  @IsUUID() branchId!: string;
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsInt() @Min(0) @Max(1439) startsAtMinute!: number;
  @IsInt() @Min(1) @Max(1440) endsAtMinute!: number;
}
export class AddProviderDateScheduleDto extends ProviderOperationReasonDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsIn(['OVERRIDE', 'TIME_OFF']) kind!: 'OVERRIDE' | 'TIME_OFF';
  @IsInt() @Min(0) @Max(1439) startsAtMinute!: number;
  @IsInt() @Min(1) @Max(1440) endsAtMinute!: number;
}
