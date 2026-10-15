import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  IsUUID,
} from 'class-validator';

export const GIFT_PRIZE_KINDS = [
  'VOUCHER_FIXED',
  'VOUCHER_PERCENT',
  'GIFT_CARD',
  'PHYSICAL_ITEM',
  'TAKEAWAY_DRINK',
  'CASH_COUNTER',
] as const;
export type GiftPrizeKind = (typeof GIFT_PRIZE_KINDS)[number];
export type PrizeConfig = Record<string, unknown>;

export class CreateGiftPrizeDto {
  @IsString() @Length(3, 160) name!: string;
  @IsOptional() @IsString() @MaxLength(1200) description?: string;
  @IsIn(GIFT_PRIZE_KINDS) kind!: GiftPrizeKind;
  @IsObject() config!: PrizeConfig;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) weight!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000000) stockTotal!: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) branchIds?: string[];
}

export class UpdateGiftPrizeDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Length(10, 500) reason!: string;
  @IsOptional() @IsString() @Length(3, 160) name?: string;
  @IsOptional() @IsString() @MaxLength(1200) description?: string;
  @IsOptional() @IsObject() config?: PrizeConfig;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) weight?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) stockTotal?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) branchIds?: string[];
}

export interface ValidPrize {
  config: PrizeConfig;
  liabilityVnd: number;
}

// Monetary units are VND integers, and liability is server derived. No negative
// discounts or uncapped percentage vouchers can be published.
function money(value: unknown, name: string, min = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > 100_000_000_000
  )
    throw new Error(name + ' phải là số nguyên VND hợp lệ.');
  return value;
}
function label(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 120)
    throw new Error(name + ' không hợp lệ.');
  return value.trim();
}
export function validateGiftPrize(
  kind: GiftPrizeKind,
  config: PrizeConfig,
  enabled: boolean,
): ValidPrize {
  if (!config || Array.isArray(config) || typeof config !== 'object')
    throw new Error('Thiếu cấu hình quà.');
  if (kind === 'CASH_COUNTER' && enabled)
    throw new Error('Quà tiền mặt chưa được phép kích hoạt; cần phê duyệt pháp lý/kế toán riêng.');
  const validityDays = config['validityDays'] === undefined ? 30 : config['validityDays'];
  if (
    typeof validityDays !== 'number' ||
    !Number.isInteger(validityDays) ||
    validityDays < 1 ||
    validityDays > 365
  )
    throw new Error('Hạn nhận quà phải từ 1 đến 365 ngày.');
  let liabilityVnd = 0;
  if (kind === 'VOUCHER_FIXED') {
    liabilityVnd = money(config['valueVnd'], 'Giá trị voucher', 1000);
    money(config['minSpendVnd'] ?? 0, 'Đơn tối thiểu');
  } else if (kind === 'VOUCHER_PERCENT') {
    const percent = config['percent'];
    if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 1 || percent > 100)
      throw new Error('Phần trăm giảm phải từ 1 đến 100.');
    liabilityVnd = money(config['maxDiscountVnd'], 'Mức giảm tối đa', 1000);
    money(config['minSpendVnd'] ?? 0, 'Đơn tối thiểu');
    if (
      enabled &&
      (!Array.isArray(config['allowedServiceIds']) || !config['allowedServiceIds'].length)
    )
      throw new Error('Voucher % phải chọn ít nhất một dịch vụ hoặc sản phẩm áp dụng.');
    if (
      config['allowedServiceIds'] !== undefined &&
      (!Array.isArray(config['allowedServiceIds']) ||
        config['allowedServiceIds'].length < 1 ||
        config['allowedServiceIds'].length > 100 ||
        config['allowedServiceIds'].some(
          (id: unknown) =>
            typeof id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
        ))
    )
      throw new Error('Danh mục dịch vụ áp dụng không hợp lệ.');
  } else if (kind === 'GIFT_CARD') {
    liabilityVnd = money(config['valueVnd'], 'Mệnh giá thẻ dùng một lần', 1000);
  } else if (kind === 'CASH_COUNTER') {
    liabilityVnd = money(config['valueVnd'], 'Giá trị tiền mặt', 1000);
  } else {
    label(config['sku'], 'Mã vật phẩm/đồ uống');
    liabilityVnd = money(config['fairValueVnd'], 'Giá trị quy đổi nội bộ', 0);
  }
  if (
    config['coverUrl'] !== undefined &&
    (typeof config['coverUrl'] !== 'string' ||
      !/^https:\/\/[a-z0-9.-]+\/[\w/-]+\.webp$/i.test(config['coverUrl']))
  )
    throw new Error('Ảnh phải là URL HTTPS WebP từ CDN đáng tin cậy.');
  return { liabilityVnd, config: { ...config, validityDays } };
}
