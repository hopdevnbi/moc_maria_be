import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateTrainingCourseDto {
  @IsString()
  @Length(2, 80)
  @Matches(/^[A-Z0-9_-]+$/)
  code!: string;
  @IsString()
  @Length(2, 180)
  title!: string;
  @IsOptional()
  @IsString()
  @Length(1, 1500)
  description?: string;
}

export class EnrollProviderDto {
  @IsUUID()
  providerApplicationId!: string;
  @IsUUID()
  courseId!: string;
}

export class AssessEnrollmentDto {
  @IsInt()
  @Min(0)
  @Max(100)
  attendancePercent!: number;
  @IsBoolean()
  assessmentPassed!: boolean;
}
