import { IsBoolean, IsEmail, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Only Super Admin can use this DTO. Username is the account email or phone. */
export class UpdateKtvAccountDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  mustChangePassword?: boolean;
}
