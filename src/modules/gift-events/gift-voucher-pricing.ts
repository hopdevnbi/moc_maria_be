import { BadRequestException } from '@nestjs/common';

/** Compute from trusted catalog prices, never a client-supplied order total. */
export function calculateVoucherDiscount(
  pricesVnd: number[],
  percent: number,
  minSpendVnd: number,
  maxDiscountVnd: number,
): { subtotalVnd: number; discountVnd: number; payableVnd: number } {
  if (
    !pricesVnd.length ||
    pricesVnd.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    !Number.isInteger(percent) ||
    percent < 1 ||
    percent > 100 ||
    !Number.isSafeInteger(minSpendVnd) ||
    minSpendVnd < 0 ||
    !Number.isSafeInteger(maxDiscountVnd) ||
    maxDiscountVnd < 0
  )
    throw new BadRequestException('INVALID_VOUCHER_PRICE_RULE');
  const subtotalVnd = pricesVnd.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(subtotalVnd)) throw new BadRequestException('VOUCHER_TOTAL_TOO_LARGE');
  const discountVnd =
    subtotalVnd < minSpendVnd
      ? 0
      : Math.min(maxDiscountVnd, Math.floor((subtotalVnd * percent) / 100));
  return { subtotalVnd, discountVnd, payableVnd: subtotalVnd - discountVnd };
}
