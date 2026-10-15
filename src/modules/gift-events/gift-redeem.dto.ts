import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import { Type } from 'class-transformer';

export class VerifyGiftDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
  @IsUUID('4') branchId!: string;
}
export class RedeemGiftDto extends VerifyGiftDto {
  @IsString() @Length(12, 90) idempotencyKey!: string;
}
export class VerifyGiftCodeDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
  @IsUUID('4') branchId!: string;
}
export class GiftVoucherLineDto {
  @IsUUID('4') variantId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10) quantity!: number;
}
export class GiftVoucherQuoteDto extends VerifyGiftCodeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GiftVoucherLineDto)
  items!: GiftVoucherLineDto[];
}
export class RedeemGiftCodeDto extends VerifyGiftCodeDto {
  @IsString() @Length(12, 90) idempotencyKey!: string;
  @IsOptional() @IsString() @Length(5, 100) saleReference?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GiftVoucherLineDto)
  items?: GiftVoucherLineDto[];
}
export class GiftCounterGrantDto {
  @IsUUID('4') userId!: string;
  @IsUUID('4') branchId!: string;
  @IsString() @Length(10, 500) reason!: string;
}
export class GiftCounterRevokeDto extends GiftCounterGrantDto {}

export type VerifyGiftResult = {
  rewardId: string;
  eventId: string;
  name: string;
  kind: string;
  expiresAt: string;
  status: 'ISSUED';
  branchId: string;
};
export type RedeemGiftResult = {
  rewardId: string;
  eventId: string;
  status: 'REDEEMED';
  branchId: string;
  redeemedAt: string;
  alreadyProcessed: boolean;
};
