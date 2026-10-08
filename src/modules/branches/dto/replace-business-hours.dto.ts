import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';

export class BusinessHourDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;
  @IsInt()
  @Min(0)
  @Max(1439)
  opensAtMinute!: number;
  @IsInt()
  @Min(1)
  @Max(1440)
  closesAtMinute!: number;
}

export class ReplaceBusinessHoursDto {
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => BusinessHourDto)
  hours!: BusinessHourDto[];
}
