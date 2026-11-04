import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export const TIP_MIN_VND = 10_000;
export const TIP_MAX_VND = 10_000_000;

/** Bank details are intentionally public when set by a KTV or SUPER_ADMIN. */
export class UpdateTipSettingsDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @Length(0, 90) bankName!: string;
  @IsString() @Length(0, 30) bankAccount!: string;
  @IsString() @Length(0, 110) accountHolder!: string;
  @IsOptional() @IsString() @Length(0, 500) qrUrl?: string;
}

/** Anonymous donors can create intentions, not verified money movements. */
export class CreateTipIntentDto {
  @IsInt() @Min(TIP_MIN_VND) @Max(TIP_MAX_VND) amountVnd!: number;
  @IsUUID() clientRequestId!: string;
}

export class TipOwnershipDto {
  @IsUUID() token!: string;
}
