import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class SaveExceptionHourDto {
  @IsDateString()
  date!: string;

  @IsBoolean()
  isClosed!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  opensAtMinute?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  closesAtMinute?: number | null;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  note?: string | null;
}
