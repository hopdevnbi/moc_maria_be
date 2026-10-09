import {
  Equals,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CreateBookingRequestDto {
  @IsUUID() variantId!: string;
  @IsUUID() branchId!: string;
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsOptional() @IsUUID() providerApplicationId?: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,80}$/) idempotencyKey!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,14})$/) expectedTotalVnd!: string;
  @Equals(true) quoteAcknowledged!: boolean;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}
export class ProviderBookingDecisionDto {
  @IsIn(['ACCEPT', 'DECLINE']) decision!: 'ACCEPT' | 'DECLINE';
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(3, 500) reason!: string;
}
export class ConfirmBookingQuoteDto {
  @IsInt() @Min(1) quoteRevision!: number;
  @IsString() @Matches(/^(0|[1-9]\d{0,14})$/) expectedTotalVnd!: string;
  @Equals(true) accepted!: boolean;
}
export class ReviseBookingQuoteDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/^(0|[1-9]\d{0,14})$/) extraFeeVnd!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,14})$/) discountVnd!: string;
  @IsString() @Length(3, 500) reason!: string;
}
