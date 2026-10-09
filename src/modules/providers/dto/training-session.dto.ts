import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ProviderOperationReasonDto } from './provider-schedule.dto';

export class CreateTrainingModuleDto extends ProviderOperationReasonDto {
  @IsString() @Matches(/^[A-Z0-9_-]{2,80}$/) code!: string;
  @IsString() @Length(2, 180) title!: string;
  @IsInt() @Min(0) @Max(32767) sortOrder!: number;
  @IsBoolean() isRequired!: boolean;
}
export class CreateTrainingSessionDto extends ProviderOperationReasonDto {
  @IsUUID() moduleId!: string;
  @IsUUID() instructorUserId!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsISO8601({ strict: true }) @Matches(/T.+(?:Z|[+-]\d{2}:\d{2})$/) startsAt!: string;
  @IsISO8601({ strict: true }) @Matches(/T.+(?:Z|[+-]\d{2}:\d{2})$/) endsAt!: string;
}
export class RecordTrainingSessionDto extends ProviderOperationReasonDto {
  @IsIn(['COMPLETED', 'CANCELLED']) status!: 'COMPLETED' | 'CANCELLED';
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,100}$/) completionReference?: string;
  @Equals(true) recordConfirmed!: boolean;
}
export class RegisterTrainingSessionDto extends ProviderOperationReasonDto {
  @IsUUID() sessionId!: string;
  @IsBoolean() isActive!: boolean;
}
export class MarkTrainingAttendanceDto extends ProviderOperationReasonDto {
  @IsIn(['PRESENT', 'ABSENT', 'EXCUSED']) status!: 'PRESENT' | 'ABSENT' | 'EXCUSED';
  @IsInt() @Min(0) @Max(480) attendedMinutes!: number;
  @IsString() @Matches(/^[A-Za-z0-9_-]{3,100}$/) evidenceReference!: string;
  @Equals(true) attendanceConfirmed!: boolean;
}
