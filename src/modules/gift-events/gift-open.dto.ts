import { Type } from 'class-transformer';
import { Equals, IsInt, IsString, Length, Max, Min } from 'class-validator';

export class OpenGiftDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(6) boxId!: number;
  @IsString() @Length(12, 90) idempotencyKey!: string;
  @Type(() => Number) @IsInt() @Min(1) termsVersion!: number;
  @Equals(true) termsAccepted!: true;
}

export type GiftOpenResult = {
  openId: string;
  eventId: string;
  boxId: number;
  termsVersion: number;
  createdAt: string;
  reward: {
    id: string;
    prizeId: string;
    name: string;
    description: string;
    kind: string;
    config: Record<string, unknown>;
    expiresAt: string;
    status: 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  };
};
