import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class VerifyGiftDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
  @IsUUID('4') branchId!: string;
}
export class RedeemGiftDto extends VerifyGiftDto {
  @IsString() @Length(12, 90) idempotencyKey!: string;
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
