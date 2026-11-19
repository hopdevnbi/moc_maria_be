import { IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
export class SaveShowcaseTranslationDto {
  @IsString() @Length(0, 240) headline!: string;
  @IsString() @Length(0, 4000) biography!: string;
  @IsString() @Length(0, 600) scheduleNote!: string;
  @IsIn(['DRAFT', 'PUBLISHED']) status!: 'DRAFT' | 'PUBLISHED';
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) sourceFingerprint!: string;
}
