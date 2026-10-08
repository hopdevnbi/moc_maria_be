import { IsDateString, IsOptional, IsString, Length, Matches } from 'class-validator';

export class IssueCertificateDto {
  @IsString()
  @Length(2, 80)
  @Matches(/^[A-Z0-9_-]+$/)
  courseCode!: string;

  @IsString()
  @Length(2, 160)
  title!: string;

  @IsString()
  @Length(6, 60)
  @Matches(/^[A-Z0-9_-]+$/)
  certificateNumber!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
