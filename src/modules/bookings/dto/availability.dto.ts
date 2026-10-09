import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
  Equals,
} from 'class-validator';
import type { BookingMode } from '../entities/booking-variant-setting.entity';
export class AvailabilityQueryDto {
  @IsUUID() variantId!: string;
  @IsUUID() branchId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsUUID() providerApplicationId?: string;
}
export class HomeAvailabilityDto extends AvailabilityQueryDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsString() @Matches(/^[A-Z0-9_-]{2,64}$/) jurisdictionCode!: string;
}
export class ResourceRequirementDto {
  @IsIn(['ROOM', 'EQUIPMENT']) kind!: 'ROOM' | 'EQUIPMENT';
  @IsInt() @Min(1) @Max(100) quantity!: number;
}
export class SaveBookingSettingDto {
  @IsUUID() variantId!: string;
  @IsUUID() branchId!: string;
  @IsIn(['AT_BRANCH', 'AT_HOME']) mode!: BookingMode;
  @IsBoolean() isEnabled!: boolean;
  @IsInt() @Min(5) @Max(60) slotStepMinutes!: number;
  @IsInt() @Min(0) @Max(43200) leadMinutes!: number;
  @IsInt() @Min(1) @Max(90) horizonDays!: number;
  @IsInt() @Min(5) @Max(120) requestTtlMinutes!: number;
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ResourceRequirementDto)
  resourceRequirements!: ResourceRequirementDto[];
  @Equals(true) configurationConfirmed!: boolean;
  @IsString() @Length(3, 500) reason!: string;
}
