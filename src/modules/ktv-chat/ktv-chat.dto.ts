import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class OpenKtvChatDto {
  @IsUUID()
  providerApplicationId!: string;
}
export class SendKtvMessageDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 2000)
  body!: string;
  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
export class ReadKtvChatDto {
  @IsUUID()
  lastMessageId!: string;
}
export class KtvHistoryDto {
  @IsOptional()
  @IsUUID()
  before?: string;
}
