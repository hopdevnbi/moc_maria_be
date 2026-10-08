import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateServiceDto {
  @IsUUID()
  categoryId!: string;
  @IsString()
  @Length(2, 160)
  name!: string;
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  description?: string;
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class CreateVariantDto {
  @IsString()
  @Length(2, 160)
  name!: string;
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes!: number;
  @IsInt()
  @Min(0)
  @Max(100000000000)
  priceVnd!: number;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferBeforeMinutes?: number;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferAfterMinutes?: number;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetBranchServiceDto {
  @IsUUID()
  serviceId!: string;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000000)
  priceOverrideVnd?: number | null;
}
