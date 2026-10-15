import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { validateGiftPrize } from './gift-prizes.dto';
import { GiftEventsService } from './gift-events.service';
import { GiftPrizesService } from './gift-prizes.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['SUPER_ADMIN'],
  permissions: ['admin.portal'],
  isActive: true,
} as AuthUserContext;
describe('P06 validated prize catalog and cap/stock control', () => {
  it('accepts fixed voucher with bounded liability, not a free-form discount', () => {
    expect(
      validateGiftPrize('VOUCHER_FIXED', { valueVnd: 50000, minSpendVnd: 200000 }, true),
    ).toMatchObject({
      liabilityVnd: 50000,
      config: { valueVnd: 50000, minSpendVnd: 200000, validityDays: 30 },
    });
  });
  it('requires max cap for percentage vouchers, rejects 0/too many percent', () => {
    expect(() =>
      validateGiftPrize('VOUCHER_PERCENT', { percent: 20, minSpendVnd: 100000 }, true),
    ).toThrow('Mức giảm tối đa');
    expect(() =>
      validateGiftPrize('VOUCHER_PERCENT', { percent: 101, maxDiscountVnd: 100000 }, true),
    ).toThrow('Phần trăm');
    expect(
      validateGiftPrize(
        'VOUCHER_PERCENT',
        {
          percent: 30,
          maxDiscountVnd: 100000,
          minSpendVnd: 0,
          allowedServiceIds: ['11111111-1111-4111-8111-111111111111'],
        },
        true,
      ).liabilityVnd,
    ).toBe(100000);
  });
  it('supports gift card, inventory item and takeaway drinks', () => {
    expect(validateGiftPrize('GIFT_CARD', { valueVnd: 200000 }, true).liabilityVnd).toBe(200000);
    expect(
      validateGiftPrize('PHYSICAL_ITEM', { sku: 'nhang-huong', fairValueVnd: 15000 }, true)
        .liabilityVnd,
    ).toBe(15000);
    expect(
      validateGiftPrize('TAKEAWAY_DRINK', { sku: 'tra-gung', fairValueVnd: 22000 }, true)
        .liabilityVnd,
    ).toBe(22000);
  });
  it('keeps cash disabled by default and never enables it through editable options', () => {
    expect(() => validateGiftPrize('CASH_COUNTER', { valueVnd: 100000 }, true)).toThrow(
      'chưa được phép',
    );
    expect(validateGiftPrize('CASH_COUNTER', { valueVnd: 100000 }, false).liabilityVnd).toBe(
      100000,
    );
  });
  it('rejects invalid expiry, negative value and unsafe cover URL', () => {
    expect(() => validateGiftPrize('VOUCHER_FIXED', { valueVnd: -1000 }, true)).toThrow();
    expect(() =>
      validateGiftPrize('VOUCHER_FIXED', { valueVnd: 50000, validityDays: 0 }, true),
    ).toThrow();
    expect(() =>
      validateGiftPrize(
        'VOUCHER_FIXED',
        { valueVnd: 50000, coverUrl: 'http://notcdn.test/a.svg' },
        true,
      ),
    ).toThrow();
  });
  it('does not allow standard Admin to write stock or prizes', async () => {
    const query = jest.fn(),
      db = { query } as unknown as DataSource;
    const service = new GiftPrizesService(db, new GiftEventsService(db));
    process.env['GIFT_EVENTS_ENABLED'] = 'true';
    await expect(
      service.create({ ...actor, roles: ['ADMIN'] }, '22222222-2222-4222-8222-222222222222', {
        name: 'Voucher ưu đãi',
        kind: 'VOUCHER_FIXED',
        config: { valueVnd: 50000 },
        weight: 1,
        stockTotal: 100,
        branchIds: ['33333333-3333-4333-8333-333333333333'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
    delete process.env['GIFT_EVENTS_ENABLED'];
  });
  it('requires location and a valid noncash config before any INSERT', async () => {
    const query = jest.fn(),
      db = { query } as unknown as DataSource;
    const service = new GiftPrizesService(db, new GiftEventsService(db));
    process.env['GIFT_EVENTS_ENABLED'] = 'true';
    await expect(
      service.create(actor, '22222222-2222-4222-8222-222222222222', {
        name: 'Voucher ưu đãi',
        kind: 'VOUCHER_PERCENT',
        config: { percent: 20 },
        weight: 1,
        stockTotal: 10,
        branchIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
    delete process.env['GIFT_EVENTS_ENABLED'];
  });
});
