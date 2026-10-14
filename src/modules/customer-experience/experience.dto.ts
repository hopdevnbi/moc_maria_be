import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  Max,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ProviderAgeDto {
  @IsInt() @Min(18) @Max(100) age!: number;
}

export class SubmitPresentationDto {
  @IsString() @Length(30, 2000) introduction!: string;
}
export class ReviewPresentationDto {
  @IsUUID() revisionId!: string;
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsString() @Length(1, 500) note!: string;
}
export class CreateInquiryDto {
  @IsUUID() idempotencyKey!: string;
  @IsUUID() providerId!: string;
  @IsString() @Length(1, 100) serviceId!: string;
  @IsIn(['AT_BRANCH', 'AT_HOME']) location!: 'AT_BRANCH' | 'AT_HOME';
  @IsString() @Length(12, 300) address!: string;
  @IsISO8601({ strict: true }) requestedAt!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}
export class ReplyInquiryDto {
  @IsIn(['CONTACTED', 'DECLINED', 'CANCELLED']) status!: 'CONTACTED' | 'DECLINED' | 'CANCELLED';
}

export class AdminInquiryQueryDto {
  @IsOptional()
  @IsIn([
    'ALL',
    'PENDING',
    'CONTACTED',
    'DECLINED',
    'CANCELLED',
    'CONFIRMED',
    'IN_SERVICE',
    'COMPLETED',
  ])
  status?:
    | 'ALL'
    | 'PENDING'
    | 'CONTACTED'
    | 'DECLINED'
    | 'CANCELLED'
    | 'CONFIRMED'
    | 'IN_SERVICE'
    | 'COMPLETED';

  @IsOptional() @IsString() @MaxLength(120) q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  archived?: boolean;
}

export class AdminReplyInquiryDto {
  @IsIn(['PENDING', 'CONTACTED', 'DECLINED', 'CANCELLED'])
  status!: 'PENDING' | 'CONTACTED' | 'DECLINED' | 'CANCELLED';
  @IsString() @Length(10, 500) reason!: string;
  @IsOptional()
  @IsIn(['PENDING', 'CONTACTED', 'DECLINED', 'CANCELLED'])
  expectedStatus?: 'PENDING' | 'CONTACTED' | 'DECLINED' | 'CANCELLED';
}

export class AdminCreateInquiryDto {
  @IsUUID() customerId!: string;
  @IsUUID() providerId!: string;
  @IsString() @Length(1, 100) serviceId!: string;
  @IsIn(['AT_BRANCH', 'AT_HOME']) location!: 'AT_BRANCH' | 'AT_HOME';
  @IsString() @Length(12, 300) address!: string;
  @IsISO8601({ strict: true }) requestedAt!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsString() @Length(10, 500) reason!: string;
}

export class AdminArchiveInquiryDto {
  @IsString() @Length(10, 500) reason!: string;
}
