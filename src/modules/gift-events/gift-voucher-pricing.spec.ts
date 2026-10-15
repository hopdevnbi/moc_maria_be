import { calculateVoucherDiscount } from './gift-voucher-pricing';

describe('V05 trusted voucher math', () => {
  it('uses whole VND and a maximum discount', () => {
    expect(calculateVoucherDiscount([249000, 69000], 30, 0, 80000)).toEqual({
      subtotalVnd: 318000,
      discountVnd: 80000,
      payableVnd: 238000,
    });
  });
  it('respects the minimum spend and rejects negative values', () => {
    expect(calculateVoucherDiscount([69000], 20, 100000, 50000).discountVnd).toBe(0);
    expect(() => calculateVoucherDiscount([-1], 20, 0, 50000)).toThrow();
    expect(() => calculateVoucherDiscount([200000], 120, 0, 50000)).toThrow();
  });
});
