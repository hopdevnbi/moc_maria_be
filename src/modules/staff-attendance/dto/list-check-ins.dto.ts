import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { CheckInStatus } from '../entities/staff-check-in.entity';

export class ListStaffCheckInsDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(['IN_RANGE', 'OUT_OF_RANGE', 'LOCATION_NOT_CONFIGURED', 'LOCATION_UNAVAILABLE'])
  status?: CheckInStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
