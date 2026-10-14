import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class DisplayVersionDto {
  @IsInt() @Min(0) expectedVersion!: number;
}

export class ReorderProviderDisplayDto extends DisplayVersionDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  providerIds!: string[];
}

export class UpdateProviderDisplayDto extends DisplayVersionDto {
  @IsOptional()
  @IsIn(['VISIBLE', 'HIDDEN', 'ARCHIVED'])
  visibility?: 'VISIBLE' | 'HIDDEN' | 'ARCHIVED';
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  publicName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) serviceArea?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) introduction?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsInt() @Min(18) @Max(100) age?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(80) yearsExperience?: number | null;
}
