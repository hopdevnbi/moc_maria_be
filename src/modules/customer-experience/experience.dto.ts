import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';

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
