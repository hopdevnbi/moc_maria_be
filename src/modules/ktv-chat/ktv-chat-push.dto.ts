import { Type } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class KtvPushSubscriptionKeysDto {
  @IsString()
  @MinLength(20)
  @MaxLength(300)
  @Matches(/^[A-Za-z0-9_-]+$/)
  p256dh!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  auth!: string;
}

export class KtvPushSubscriptionDto {
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\/[^\s]+$/i)
  endpoint!: string;

  @ValidateNested()
  @Type(() => KtvPushSubscriptionKeysDto)
  keys!: KtvPushSubscriptionKeysDto;
}

export class KtvPushUnsubscribeDto {
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\/[^\s]+$/i)
  endpoint!: string;
}
