import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// IDs from the existing care presentation catalog; actual booking eligibility
// continues to be governed by the provider's training and service policies.
export const KTV_CARE_SERVICE_IDS = [
  'demo-relaxation',
  'demo-hot-stone',
  'demo-neck',
  'demo-foot',
  'demo-herbal',
  'demo-pressure',
  'demo-aroma',
  'demo-thai',
  'demo-back',
  'demo-hair',
] as const;

export class CreateKtvDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  publicName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceArea?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  introduction?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsIn(KTV_CARE_SERVICE_IDS, { each: true })
  serviceIds!: (typeof KTV_CARE_SERVICE_IDS)[number][];
}
