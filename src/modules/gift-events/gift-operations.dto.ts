import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class GiftOperationsFilterDto {
  @IsOptional() @IsUUID('4') eventId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
export class GiftRetryNoticeDto {
  @IsString() @Length(10, 300) reason!: string;
}
export class GiftNoticeChannelDto {
  @IsIn(['email', 'zalo']) channel!: 'email' | 'zalo';
}
