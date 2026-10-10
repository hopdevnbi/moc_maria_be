import {
  Equals,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
export class StartSafetyDto {
  @Matches(/^[a-f0-9]{64}$/) inquiryId!: string;
  @Equals(true) consent!: boolean;
  @IsISO8601() expectedCheckAt!: string;
}
export class SafetyPointDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsNumber() @Min(0) @Max(100000) accuracy!: number;
  @IsISO8601() recordedAt!: string;
}
export class SafetyActionDto {
  @IsEnum(['PAUSE', 'RESUME', 'ARRIVED', 'FINISH', 'STOP', 'SOS']) action!:
    'PAUSE' | 'RESUME' | 'ARRIVED' | 'FINISH' | 'STOP' | 'SOS';
  @IsOptional() @IsInt() @Min(15) @Max(240) checkAfterMinutes?: number;
}
export class SafetyIncidentDto {
  @IsUUID() alertId!: string;
  @IsEnum(['ACKNOWLEDGE', 'RESOLVE']) action!: 'ACKNOWLEDGE' | 'RESOLVE';
  @IsString() @Matches(/^.{5,300}$/s) note!: string;
}
