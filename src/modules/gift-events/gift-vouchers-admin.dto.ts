import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GiftVoucherFilterDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID('4') customerId?: string;
}
export class VoidGiftVoucherDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(10, 500) reason!: string;
}
