import { ConflictException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import { GiftOpenService, giftCustomerTier, pickGiftWeighted } from './gift-open.service';
import { OpenGiftDto } from './gift-open.dto';
import { GiftNotificationsService } from './gift-notifications.service';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['CUSTOMER'],
  permissions: ['customers.portal'],
  isActive: true,
} as AuthUserContext;
const eventId = '22222222-2222-4222-8222-222222222222';
const dto: OpenGiftDto = {
  boxId: 3,
  idempotencyKey: 'stable-request-key-123456789',
  termsAccepted: true,
  termsVersion: 1,
};
const now = new Date();
type DrawState = {
  eventStatus: 'LIVE' | 'PAUSED' | 'ENDED';
  rewardStatus: 'ISSUED' | 'REDEEMED';
};

function fixture({
  noPrizes = false,
  allowed = true,
  budgetRemaining = 500000,
  requiresCompletedService = false,
  hasCompletedService = false,
  state = { eventStatus: 'LIVE', rewardStatus: 'ISSUED' },
} = {}): {
  service: GiftOpenService;
  statements: Array<{ sql: string; params: unknown[] }>;
  calls: { stock: number; budget: number; rewards: number };
} {
  let entry: Record<string, unknown> | null = null;
  const statements: Array<{ sql: string; params: unknown[] }> = [],
    calls = { stock: 0, budget: 0, rewards: 0 };
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (sql.includes('FROM gift_event_campaigns WHERE id=') && sql.includes('FOR UPDATE'))
      return Promise.resolve([
        {
          id: eventId,
          status: state.eventStatus,
          start_at: new Date(now.getTime() - 3600000),
          end_at: new Date(now.getTime() + 3600000),
          terms_version: 1,
          budget_cap_vnd: String(budgetRemaining),
          budget_reserved_vnd: '0',
          requires_completed_service: requiresCompletedService,
        },
      ]);
    if (sql.includes('FROM users u WHERE u.id='))
      return Promise.resolve([{ is_active: true, must_change_password: false, is_customer: true }]);
    if (sql.startsWith('SELECT * FROM gift_event_entries'))
      return Promise.resolve(entry ? [entry] : []);
    if (sql.includes('FROM gift_event_rewards') && sql.includes('WHERE entry_id'))
      return Promise.resolve([
        {
          id: '44444444-4444-4444-8444-444444444444',
          prize_id: '33333333-3333-4333-8333-333333333333',
          status: state.rewardStatus,
          reward_snapshot: {
            name: 'Voucher chăm sóc',
            description: 'Tri ân',
            kind: 'VOUCHER_FIXED',
            config: { valueVnd: 50000, validityDays: 30 },
          },
          expires_at: new Date(now.getTime() + 30 * 86400000),
        },
      ]);
    if (sql.includes('AS completed')) return Promise.resolve([{ completed: hasCompletedService }]);
    if (sql.includes('FROM app_metadata')) return Promise.resolve([]);
    if (sql.includes('FROM gift_event_tiers'))
      return Promise.resolve(allowed ? [{ tier_code: 'STANDARD' }] : []);
    if (sql.includes('FROM gift_event_prizes p'))
      return Promise.resolve(
        noPrizes
          ? []
          : [
              {
                id: '33333333-3333-4333-8333-333333333333',
                name: 'Voucher chăm sóc',
                description: 'Tri ân',
                kind: 'VOUCHER_FIXED',
                weight: 10,
                stock_total: 10,
                stock_issued: 0,
                liability_vnd: '50000',
                config: { valueVnd: 50000, validityDays: 30 },
              },
            ],
      );
    if (sql.startsWith('UPDATE gift_event_prizes')) {
      calls.stock++;
      return Promise.resolve([{ stock_issued: 1 }]);
    }
    if (sql.startsWith('UPDATE gift_event_campaigns') && sql.includes('budget_reserved_vnd=')) {
      calls.budget++;
      return Promise.resolve([{ budget_reserved_vnd: '50000' }]);
    }
    if (sql.startsWith('INSERT INTO gift_event_entries')) {
      entry = {
        id: '55555555-5555-4555-8555-555555555555',
        selected_box: params[4],
        idempotency_key: params[2],
        request_fingerprint: params[3],
        accepted_terms_version: 1,
        created_at: now,
      };
      return Promise.resolve([entry]);
    }
    if (sql.startsWith('SELECT branch_id FROM gift_event_prize_branches'))
      return Promise.resolve([{ branch_id: '66666666-6666-4666-8666-666666666666' }]);
    if (sql.startsWith('INSERT INTO gift_event_rewards')) {
      calls.rewards++;
      return Promise.resolve([
        {
          id: '44444444-4444-4444-8444-444444444444',
          prize_id: '33333333-3333-4333-8333-333333333333',
        },
      ]);
    }
    return Promise.resolve([]);
  });
  const db = {
    query,
    transaction: (run: (m: EntityManager) => unknown) => run({ query } as unknown as EntityManager),
  } as unknown as DataSource;
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
  return {
    service: new GiftOpenService(db, new GiftEventsService(db), {
      enqueue: async (m: EntityManager, notice: { rewardId: string }) => {
        await m.query(
          'INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING',
          ['mocmaria.gift.notify.email.' + notice.rewardId, JSON.stringify(notice)],
        );
      },
    } as unknown as GiftNotificationsService),
    statements,
    calls,
  };
}
afterEach(() => delete process.env['GIFT_EVENTS_ENABLED']);

describe('P07 secure box opening', () => {
  it('exact tiers use VIP expiry, legacy VIP1, and STANDARD fallback', () => {
    const t = new Date('2026-10-15T10:00:00Z');
    expect(giftCustomerTier(null, t)).toBe('STANDARD');
    expect(giftCustomerTier({ isVip: true, level: 2, expiresAt: '2026-11-15T10:00:00Z' }, t)).toBe(
      'VIP2',
    );
    expect(giftCustomerTier({ isVip: true, expiresAt: null }, t)).toBe('VIP1');
    expect(giftCustomerTier({ isVip: true, level: 2, expiresAt: '2026-10-15T10:00:00Z' }, t)).toBe(
      'STANDARD',
    );
    expect(giftCustomerTier({ isVip: false, level: 99 }, t)).toBe('STANDARD');
  });
  it('weighted selection boundaries are deterministic in tests; no box-driven prize', () => {
    const pool = [
      { name: 'a', weight: 1 },
      { name: 'b', weight: 4 },
      { name: 'c', weight: 2 },
    ];
    expect(pickGiftWeighted(pool, 0).name).toBe('a');
    expect(pickGiftWeighted(pool, 1).name).toBe('b');
    expect(pickGiftWeighted(pool, 4).name).toBe('b');
    expect(pickGiftWeighted(pool, 5).name).toBe('c');
    expect(() => pickGiftWeighted(pool, 7)).toThrow();
  });
  it('atomically records only one entry, issued reward, stock and budget', async () => {
    const { service, statements, calls } = fixture();
    const result = await service.open(user, eventId, dto);
    expect(result).toMatchObject({
      eventId,
      boxId: 3,
      reward: { kind: 'VOUCHER_FIXED', name: 'Voucher chăm sóc', status: 'ISSUED' },
    });
    expect(calls).toEqual({ stock: 1, budget: 1, rewards: 1 });
    expect(statements.some((s) => s.sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(statements.some((s) => s.sql.includes('stock_issued<stock_total'))).toBe(true);
    expect(statements.some((s) => s.sql.includes('budget_reserved_vnd+$2<=budget_cap_vnd'))).toBe(
      true,
    );
  });
  it('retry same idempotency key returns exactly same gift without taking more stock', async () => {
    const { service, calls } = fixture();
    const first = await service.open(user, eventId, dto);
    const second = await service.open(user, eventId, dto);
    expect(second.openId).toBe(first.openId);
    expect(second.reward.id).toBe(first.reward.id);
    expect(calls).toEqual({ stock: 1, budget: 1, rewards: 1 });
  });
  it('retries a committed draw after event ends, retaining redeemed status without another award', async () => {
    const state: DrawState = { eventStatus: 'LIVE', rewardStatus: 'ISSUED' };
    const { service, calls } = fixture({ state });
    const first = await service.open(user, eventId, dto);
    state.eventStatus = 'ENDED';
    state.rewardStatus = 'REDEEMED';
    const recovered = await service.open(user, eventId, dto);
    expect(recovered.openId).toBe(first.openId);
    expect(recovered.reward).toMatchObject({ id: first.reward.id, status: 'REDEEMED' });
    expect(calls).toEqual({ stock: 1, budget: 1, rewards: 1 });
  });
  it('blocks a new open on a paused event without consuming stock', async () => {
    const { service, calls } = fixture({
      state: { eventStatus: 'PAUSED', rewardStatus: 'ISSUED' },
    });
    await expect(service.open(user, eventId, dto)).rejects.toThrow('EVENT_PAUSED');
    expect(calls).toEqual({ stock: 0, budget: 0, rewards: 0 });
  });
  it('same account with changed key or payload cannot open twice', async () => {
    const { service, calls } = fixture();
    await service.open(user, eventId, dto);
    await expect(
      service.open(user, eventId, { ...dto, idempotencyKey: 'another-key-123456789' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.open(user, eventId, { ...dto, boxId: 6 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls.rewards).toBe(1);
  });
  it('allows new customers without previous services when optional condition is disabled', async () => {
    const { service, calls, statements } = fixture({ requiresCompletedService: false });
    await service.open(user, eventId, dto);
    expect(calls.rewards).toBe(1);
    expect(statements.some((s) => s.sql.includes('AS completed'))).toBe(false);
  });
  it('blocks customers with no completed service when requirement is enabled', async () => {
    const { service, calls, statements } = fixture({ requiresCompletedService: true });
    await expect(service.open(user, eventId, dto)).rejects.toThrow('SERVICE_NOT_COMPLETED');
    expect(calls.rewards).toBe(0);
    expect(statements.some((s) => s.sql.includes('AS completed'))).toBe(true);
  });
  it('permits verified prior customers when requirement is enabled', async () => {
    const { service, calls } = fixture({
      requiresCompletedService: true,
      hasCompletedService: true,
    });
    await service.open(user, eventId, dto);
    expect(calls.rewards).toBe(1);
  });
  it('does not award a gift when account is not allowed to participate', async () => {
    const { service, calls } = fixture({ allowed: false });
    await expect(service.open(user, eventId, dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.rewards).toBe(0);
  });
  it('pauses and preserves the turn if stock/budget has run out', async () => {
    const { service, statements, calls } = fixture({ noPrizes: true });
    await expect(service.open(user, eventId, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(calls).toEqual({ stock: 0, budget: 0, rewards: 0 });
    expect(statements.some((s) => s.sql.includes("status='PAUSED'"))).toBe(true);
    expect(statements.some((s) => s.sql.includes('GIFT_EVENT_AUTO_PAUSED'))).toBe(true);
    expect(statements.some((s) => s.sql.includes('INSERT INTO gift_event_entries'))).toBe(false);
  });
  it('validated DTO blocks out-of-range boxes, short keys and false terms consent', async () => {
    const v = plainToInstance(OpenGiftDto, {
      boxId: 7,
      idempotencyKey: 'x',
      termsVersion: 0,
      termsAccepted: false,
    });
    expect((await validate(v)).map((x) => x.property)).toEqual(
      expect.arrayContaining(['boxId', 'idempotencyKey', 'termsVersion', 'termsAccepted']),
    );
  });
});
