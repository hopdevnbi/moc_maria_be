import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class OpenKtvChatDto {
  @IsUUID()
  providerApplicationId!: string;
}
export class KtvChatPasswordDto {
  @IsString()
  @Length(1, 128)
  password!: string;
}
export class SetKtvChatPasswordDto {
  @IsString()
  @Length(6, 128)
  password!: string;
  @IsOptional()
  @IsString()
  @Length(1, 128)
  currentPassword?: string;
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
export class BlockKtvChatDto {
  @IsIn(['TEMPORARY', 'PERMANENT'])
  mode!: 'TEMPORARY' | 'PERMANENT';
  @ValidateIf((dto: BlockKtvChatDto) => dto.mode === 'TEMPORARY')
  @IsInt()
  @Min(1)
  @Max(525600)
  durationMinutes?: number;
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(0, 200)
  reason?: string;
}
