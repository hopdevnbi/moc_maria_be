import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class SaveCatalogTranslationDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 12000)
  description?: string | null;

  @IsIn(['DRAFT', 'PUBLISHED'])
  status!: 'DRAFT' | 'PUBLISHED';

  @IsInt()
  @Min(0)
  @Max(2147483646)
  expectedVersion!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  sourceFingerprint!: string;
}
