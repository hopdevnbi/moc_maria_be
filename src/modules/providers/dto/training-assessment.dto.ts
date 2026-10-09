import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
export class ModuleRequirementDto {
  @IsInt() @Min(1) @Max(4800) requiredMinutes!: number;
  @IsBoolean() isRequired!: boolean;
  @IsBoolean() isActive!: boolean;
  @Equals(true) requirementsConfirmed!: boolean;
  @IsString() @Length(3, 500) reason!: string;
}
export class TrainingCriterionDto {
  @IsString() @Length(2, 80) @Matches(/^[A-Z0-9_-]+$/) code!: string;
  @IsString() @Length(2, 180) title!: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsInt() @Min(1) @Max(100) minimumScore!: number;
  @IsBoolean() isRequired!: boolean;
  @IsBoolean() isActive!: boolean;
  @Equals(true) criteriaConfirmed!: boolean;
  @IsString() @Length(3, 500) reason!: string;
}
export class CriterionScoreDto {
  @IsUUID() criterionId!: string;
  @IsInt() @Min(0) @Max(100) score!: number;
}
export class DetailedAssessmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CriterionScoreDto)
  scores!: CriterionScoreDto[];
  @IsString() @Length(3, 100) @Matches(/^[A-Za-z0-9_-]+$/) evidenceReference!: string;
  @IsDateString({ strict: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/) validUntil!: string;
  @Equals(true) practicalConfirmed!: boolean;
  @IsString() @Length(3, 500) reason!: string;
}
