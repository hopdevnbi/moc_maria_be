import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
export class CreateProviderReviewDto {
  @IsUUID() appointmentId!: string;
  @IsUUID() providerApplicationId!: string;
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 2000)
  comment!: string;
}
export class EditProviderReviewDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 2000)
  comment!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
export class ModerateProviderReviewDto {
  @IsIn(['PUBLISHED', 'HIDDEN']) visibility!: 'PUBLISHED' | 'HIDDEN';
  @IsString() @Length(10, 500) reason!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
export class ProviderReviewPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
}
export class EligibleProviderReviewDto {
  @IsOptional() @IsUUID() providerApplicationId?: string;
}
export class AdminProviderReviewPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional()
  @IsIn(['ALL', 'PENDING', 'PUBLISHED', 'HIDDEN'])
  status?: 'ALL' | 'PENDING' | 'PUBLISHED' | 'HIDDEN';
}
