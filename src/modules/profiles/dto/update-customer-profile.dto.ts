import {
  IsEmail,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName?: string;

  @ValidateIf((value: UpdateCustomerProfileDto) => value.email !== undefined && value.email !== '')
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  birthday?: string | null;

  @IsOptional()
  @IsObject()
  contactPreferences?: Record<string, boolean>;
}
