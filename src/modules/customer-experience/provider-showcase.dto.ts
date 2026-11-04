import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SHOWCASE_MEDIA_CONSENT = 'PUBLIC_PROFILE_MEDIA_V1';

export class ShowcaseHoursDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsString() @Length(5, 5) startsAt!: string;
  @IsString() @Length(5, 5) endsAt!: string;
}

export class ShowcaseMediaDto {
  @IsUUID() id!: string;
  @IsIn(['IMAGE', 'VIDEO']) kind!: 'IMAGE' | 'VIDEO';
  @IsString() @Length(20, 500) url!: string;
  @IsOptional() @IsString() @Length(0, 120) caption?: string;
}

export class UpdateShowcaseDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @Length(0, 110) headline!: string;
  @IsString() @Length(0, 2000) biography!: string;
  @IsString() @Length(0, 300) scheduleNote!: string;
  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => ShowcaseHoursDto)
  weeklyHours!: ShowcaseHoursDto[];
  @IsArray()
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => ShowcaseMediaDto)
  media!: ShowcaseMediaDto[];
}
