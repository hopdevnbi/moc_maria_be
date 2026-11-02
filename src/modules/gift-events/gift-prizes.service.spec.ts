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
  it('adds exactly two 50% rewards without increasing the 100-slot pool or rewriting issued rewards', async () => {
    process.env['GIFT_EVENTS_ENABLED'] = 'true';
    try {
      const prizes = [10, 15, 20, 25, 30].map((percent, i) => ({
        id: '11111111-1111-4111-8111-' + String(i + 1).padStart(12, '0'),
        event_id: '22222222-2222-4222-8222-222222222222',
        kind: 'VOUCHER_PERCENT',
        name: 'Voucher giảm ' + percent + '%',
        config: {
          percent,
          maxDiscountVnd: 150000,
          validityDays: 30,
          minSpendVnd: 0,
          allowedServiceIds: ['11111111-1111-4111-8111-111111111111'],
        },
        enabled: true,
        stock_total: 20,
        stock_issued: [1, 1, 2, 0, 0][i],
        liability_vnd: '150000',
        weight: 20,
        version: 1,
      }));
      const query = jest.fn((sql: string) => {
        if (sql.startsWith('SELECT code,status,version'))
          return [
            {
              code: 'moc-maria-tri-an-thang-11-2026',
              status: 'LIVE',
              version: 5,
              terms_text: 'Giảm 10%-30%, tối đa 150.000đ, 100 suất.',
              description: 'Ưu đãi 10%-30%',
            },
          ];
        if (sql.startsWith('SELECT * FROM gift_event_prizes')) return prizes;
        if (sql.startsWith('SELECT pb.branch_id'))
          return [{ branch_id: '33333333-3333-4333-8333-333333333333' }];
        if (sql.startsWith('INSERT INTO gift_event_prizes'))
          return [{ id: '44444444-4444-4444-8444-444444444444' }];
        return [];
      });
      const db = {
        transaction: async (fn: (manager: unknown) => Promise<unknown>) => fn({ query }),
      } as unknown as DataSource;
      const service = new GiftPrizesService(db, new GiftEventsService(db));
      const result = await service.addRareFifty(actor, '22222222-2222-4222-8222-222222222222', {
        expectedVersion: 5,
        reason: 'Bổ sung voucher hiếm theo poster chiến dịch',
      });
      expect(result).toEqual({ configured: true, stockTotal: 100, fiftyPercentSlots: 2 });
      const calls = query.mock.calls as Array<[string, ...unknown[]]>;
      const insert = calls.find(([sql]) => sql.startsWith('INSERT INTO gift_event_prizes'));
      expect(insert).toBeDefined();
      const insertParams = (insert as unknown as [string, unknown[]])[1];
      const newPrize = JSON.parse(String(insertParams[3])) as {
        percent: number;
        maxDiscountVnd: number;
      };
      expect(newPrize).toMatchObject({ percent: 50, maxDiscountVnd: 150000 });
      expect(insertParams[4]).toBe(150000);
      const stockChanges = calls.filter(([sql]) => sql.startsWith('UPDATE gift_event_prizes'));
      expect(stockChanges).toHaveLength(1);
      expect(stockChanges[0][0]).toContain('stock_total=stock_total-2');
      expect(calls.some(([sql]) => sql.includes('terms_version=terms_version+1'))).toBe(true);
      expect(calls.some(([sql]) => sql.includes('RARE_50_VOUCHER_ADDED'))).toBe(true);
      expect(calls.some(([sql]) => sql.includes('UPDATE gift_event_rewards'))).toBe(false);
    } finally {
      delete process.env['GIFT_EVENTS_ENABLED'];
    }
  });
  it('refuses a duplicate 50% voucher before any write', async () => {
    process.env['GIFT_EVENTS_ENABLED'] = 'true';
    try {
      const query = jest.fn((sql: string) => {
        if (sql.startsWith('SELECT code,status,version'))
          return [
            {
              code: 'moc-maria-tri-an-thang-11-2026',
              status: 'LIVE',
              version: 6,
              terms_text: 'Giảm 10%-50%',
              description: 'Giảm 10%-50%',
            },
          ];
        if (sql.startsWith('SELECT * FROM gift_event_prizes'))
          return [
            {
              kind: 'VOUCHER_PERCENT',
              config: { percent: 50 },
            },
          ];
        return [];
      });
      const db = {
        transaction: async (fn: (manager: unknown) => Promise<unknown>) => fn({ query }),
      } as unknown as DataSource;
      const service = new GiftPrizesService(db, new GiftEventsService(db));
      await expect(
        service.addRareFifty(actor, '22222222-2222-4222-8222-222222222222', {
          expectedVersion: 6,
          reason: 'Không tạo trùng voucher đặc biệt',
        }),
      ).rejects.toThrow('không tạo trùng');
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env['GIFT_EVENTS_ENABLED'];
    }
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
