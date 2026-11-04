import { IsNumber, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class CreateStaffCheckInDto {
  @IsUUID()
  branchId!: string;

  @ValidateIf((obj: CreateStaffCheckInDto) => obj.latitude !== undefined && obj.latitude !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ValidateIf((obj: CreateStaffCheckInDto) => obj.longitude !== undefined && obj.longitude !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100000)
  accuracyMeters?: number;
}
