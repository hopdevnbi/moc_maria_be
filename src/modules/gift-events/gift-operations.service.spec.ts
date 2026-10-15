import { BadRequestException } from '@nestjs/common';
import { giftOpsRange, giftOpsCsv } from './gift-operations.service';

describe('V07/V08 voucher operations', () => {
  it('rejects invalid and oversized date windows', () => {
    expect(() => giftOpsRange('2026-11-30', '2026-11-01')).toThrow(BadRequestException);
    expect(() => giftOpsRange('2025-01-01', '2026-11-01')).toThrow(BadRequestException);
  });
  it('escapes spreadsheet formulas', () => {
    const csv = giftOpsCsv({
      generatedAt: '',
      from: '',
      to: '',
      timezone: 'Asia/Ho_Chi_Minh',
      events: [
        {
          eventId: 'id',
          code: 'test',
          title: '=2+3',
          issued: 1,
          redeemed: 0,
          voided: 0,
          expired: 0,
          outstanding: 1,
          discountVnd: 0,
        },
      ],
      daily: [],
      deliveries: [],
      lowStock: [],
    });
    expect(csv).toContain("'=2+3");
  });
});
