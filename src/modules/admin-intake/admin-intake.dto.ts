import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateCustomerAccountDto {
  @IsString() @Length(2, 160) displayName!: string;
  @ValidateIf((value: CreateCustomerAccountDto) => !!value.email)
  @IsEmail()
  @MaxLength(320)
  email?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsBoolean() sendEmail?: boolean;
}
