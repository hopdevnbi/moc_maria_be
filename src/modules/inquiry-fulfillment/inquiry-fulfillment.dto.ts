import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class ConfirmInquiryDto {
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsBoolean() customerAgreementConfirmed!: boolean;
  @IsOptional() @IsBoolean() historicalBookingConfirmed?: boolean;
  @IsString() @Length(10, 500) reason!: string;
}

export class ChangeFulfillmentDto {
  @IsIn(['IN_SERVICE', 'COMPLETED', 'CANCELLED']) status!: 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED';
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(10, 500) reason!: string;
  @IsOptional() @IsBoolean() servicePerformedConfirmed?: boolean;
}
