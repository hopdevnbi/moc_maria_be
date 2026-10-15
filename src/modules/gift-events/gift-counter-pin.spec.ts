import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftWalletService, hashGiftCounterPin } from './gift-wallet.service';
import { GiftEventsService } from './gift-events.service';
import { GiftRedeemService } from './gift-redeem.service';

const rewardId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';
const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  isActive: true,
  roles: ['CUSTOMER'],
  permissions: [],
  mustChangePassword: false,
  email: null,
  phone: null,
  displayName: 'Test Customer',
  sessionId: 'test-session',
} as AuthUserContext;
beforeEach(() => {
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
  process.env['GIFT_COUNTER_PIN_SECRET'] = 'test-only-very-long-private-secret-for-hmac-v01';
});
afterEach(() => {
  delete process.env['GIFT_EVENTS_ENABLED'];
  delete process.env['GIFT_COUNTER_PIN_SECRET'];
});

describe('V02/V04 short-lived six-digit counter code', () => {
  it('fails closed when PIN signing configuration is missing', () => {
    delete process.env['GIFT_COUNTER_PIN_SECRET'];
    expect(() => hashGiftCounterPin('123456')).toThrow(ConflictException);
  });
  it('never accepts malformed codes and stores only a keyed hash', async () => {
    expect(() => hashGiftCounterPin('12345')).toThrow();
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const query = jest.fn((sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      if (sql.includes('FROM gift_event_rewards') && sql.includes('FOR UPDATE'))
        return Promise.resolve([{ status: 'ISSUED', expires_at: new Date('2099-01-01') }]);
      return Promise.resolve([]);
    });
    const db = {
      query,
      transaction: (fn: (m: EntityManager) => unknown) => fn({ query } as unknown as EntityManager),
    } as unknown as DataSource;
    const service = new GiftWalletService(db, new GiftEventsService(db));
    const result = await service.issuePin(actor, rewardId);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(calls.find((c) => c.sql.includes('INSERT INTO gift_event_counter_pins'))?.args[1]).toBe(
      hashGiftCounterPin(result.code),
    );
    expect(JSON.stringify(calls)).not.toContain('"' + result.code + '"');
  });
  it('requires branch authorization before looking up a submitted code', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('FROM branches WHERE id=')) return Promise.resolve([{ id: branchId }]);
      return Promise.resolve([]);
    });
    const db = { query, manager: { query } } as unknown as DataSource;
    const service = new GiftRedeemService(db, new GiftEventsService(db));
    await expect(service.verifyCode(actor, { code: '123456', branchId })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(query.mock.calls.some((call) => call[0].includes('FROM gift_event_counter_pins'))).toBe(
      false,
    );
  });
  it('checks code expiry and matching branch on server', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('FROM branches WHERE id=')) return Promise.resolve([{ id: branchId }]);
      if (sql.includes('FROM gift_event_counter_pins t'))
        return Promise.resolve([
          {
            reward_id: rewardId,
            token_hash: hashGiftCounterPin('123456'),
            token_expires_at: new Date(Date.now() - 1000),
            id: rewardId,
            event_id: eventId,
            reward_snapshot: {
              name: 'Massage 20%',
              kind: 'VOUCHER_PERCENT',
              allowedBranchIds: [branchId],
            },
            status: 'ISSUED',
            expires_at: new Date('2099-01-01'),
          },
        ]);
      return Promise.resolve([]);
    });
    const db = { query, manager: { query } } as unknown as DataSource;
    const service = new GiftRedeemService(db, new GiftEventsService(db));
    await expect(
      service.verifyCode(
        { ...actor, roles: ['SUPER_ADMIN'], permissions: ['admin.portal'] },
        { code: '123456', branchId },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
