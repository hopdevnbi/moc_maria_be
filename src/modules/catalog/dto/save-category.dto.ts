import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class SaveCategoryDto {
  @IsString()
  @Length(2, 160)
  name!: string;
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(2, 100)
  slug!: string;
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string | null;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  sortOrder?: number;
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
