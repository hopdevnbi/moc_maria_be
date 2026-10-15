import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const EVENT_ACTIONS = ['PUBLISH', 'PAUSE', 'RESUME', 'END', 'ARCHIVE'] as const;
export type EventAction = (typeof EVENT_ACTIONS)[number];

export class CreateGiftEventDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{2,59}$/) code!: string;
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/) slug!: string;
  @IsString() @Length(4, 160) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(20000) termsText?: string;
  @IsOptional() @IsUrl({ require_tld: true }) @MaxLength(2048) heroUrl?: string;
  @IsOptional() @IsISO8601({ strict: true }) startAt?: string;
  @IsOptional() @IsISO8601({ strict: true }) endAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000_000) budgetCapVnd?: number;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  eligibleTiers?: string[];
}

export class UpdateGiftEventDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(10, 500) reason!: string;
  @IsOptional() @IsString() @Length(4, 160) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(20000) termsText?: string;
  @IsOptional() @IsUrl({ require_tld: true }) @MaxLength(2048) heroUrl?: string;
  @IsOptional() @IsISO8601({ strict: true }) startAt?: string;
  @IsOptional() @IsISO8601({ strict: true }) endAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000_000) budgetCapVnd?: number;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  eligibleTiers?: string[];
}

export class EventActionDto {
  @IsString() @Length(10, 500) reason!: string;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export type GiftEventStatus = 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'ENDED' | 'ARCHIVED';
export const DEFAULT_GIFT_TIERS = ['STANDARD'] as const;
export function normalizeGiftTiers(tiers: string[] | undefined): string[] {
  if (tiers === undefined) return ['STANDARD'];
  if (!Array.isArray(tiers) || !tiers.length || tiers.length > 100)
    throw new Error('Phải chọn ít nhất một hạng khách hợp lệ.');
  const result = [...new Set(tiers)];
  if (result.some((tier) => tier !== 'STANDARD' && !/^VIP([1-9]|[1-9][0-9])$/.test(tier)))
    throw new Error('Hạng hợp lệ là THƯỜNG hoặc VIP1–VIP99, chọn đúng từng hạng.');
  return result;
}

export function effectiveGiftStatus(
  status: GiftEventStatus,
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): GiftEventStatus {
  if (status === 'DRAFT' || status === 'PAUSED' || status === 'ARCHIVED' || status === 'ENDED')
    return status;
  if (endAt && now >= endAt) return 'ENDED';
  if (startAt && now >= startAt && endAt && now < endAt) return 'LIVE';
  return 'SCHEDULED';
}

export function assertGiftTimeWindow(startAt: string | null, endAt: string | null): void {
  if (!!startAt !== !!endAt) throw new Error('Phải điền đủ cả giờ bắt đầu và kết thúc.');
  if (
    startAt &&
    endAt &&
    (!Number.isFinite(Date.parse(startAt)) ||
      !Number.isFinite(Date.parse(endAt)) ||
      Date.parse(endAt) <= Date.parse(startAt))
  )
    throw new Error('Thời gian kết thúc phải sau bắt đầu.');
}
