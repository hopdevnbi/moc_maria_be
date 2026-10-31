import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import { GiftPlayAdminService } from './gift-play-admin.service';

const eventId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const admin = {
  id: '33333333-3333-4333-8333-333333333333',
  roles: ['SUPER_ADMIN'],
  permissions: ['admin.portal'],
  isActive: true,
} as AuthUserContext;

function fixture(
  status: 'ISSUED' | 'REDEEMED' = 'ISSUED',
  active = true,
): {
  service: GiftPlayAdminService;
  sqls: string[];
  query: jest.Mock<Promise<unknown[]>, [string]>;
} {
  const sqls: string[] = [];
  const query = jest.fn((sql: string): Promise<unknown[]> => {
    sqls.push(sql);
    if (sql.startsWith('SELECT id FROM gift_event_campaigns'))
      return Promise.resolve([{ id: eventId }]);
    if (sql.startsWith('SELECT id,selected_box,created_at FROM gift_event_entries'))
      return Promise.resolve(
        active ? [{ id: 'entry-id', selected_box: 3, created_at: new Date() }] : [],
      );
    if (sql.startsWith('SELECT id,prize_id,status FROM gift_event_rewards'))
      return Promise.resolve([{ id: 'reward-id', prize_id: 'prize-id', status }]);
    if (sql.startsWith('UPDATE gift_event_entries'))
      return Promise.resolve([{ reset_at: new Date() }]);
    if (sql.startsWith('INSERT INTO gift_event_play_resets'))
      return Promise.resolve([{ id: 'reset-id', created_at: new Date() }]);
    return Promise.resolve([]);
  });
  const db = {
    query,
    transaction: (fn: (m: EntityManager) => unknown) => fn({ query } as unknown as EntityManager),
  } as unknown as DataSource;
  return { service: new GiftPlayAdminService(db, new GiftEventsService(db)), sqls, query };
}
beforeEach(() => {
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
});
afterEach(() => {
  delete process.env['GIFT_EVENTS_ENABLED'];
});

describe('gift Super Admin reset', () => {
  const reason = 'Kiểm thử lại lượt mở quà';
  it('requires SUPER_ADMIN with admin.portal', async () => {
    const { service, query } = fixture();
    await expect(
      service.reset({ ...admin, roles: ['CUSTOMER'] }, eventId, userId, { reason }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });
  it('voids ISSUED, preserves accounting and saves both audit records', async () => {
    const { service, sqls } = fixture();
    const result = await service.reset(admin, eventId, userId, { reason });
    expect(result.after['rewardStatus']).toBe('VOIDED');
    expect(sqls).toContainEqual(expect.stringContaining("SET status='VOIDED'"));
    expect(sqls).toContainEqual(expect.stringContaining('SET reset_at=clock_timestamp()'));
    expect(sqls).toContainEqual(expect.stringContaining('INSERT INTO gift_event_play_resets'));
    expect(sqls).toContainEqual(expect.stringContaining('INSERT INTO gift_event_admin_audit'));
    expect(
      sqls.some(
        (s) =>
          s.includes('budget_reserved_vnd=') ||
          s.includes('stock_issued=') ||
          s.includes('DELETE FROM gift_event_rewards'),
      ),
    ).toBe(false);
  });
  it('does not change an already redeemed reward', async () => {
    const { service, sqls } = fixture('REDEEMED');
    const result = await service.reset(admin, eventId, userId, { reason });
    expect(result.after['rewardStatus']).toBe('REDEEMED');
    expect(sqls.some((s) => s.startsWith('UPDATE gift_event_rewards'))).toBe(false);
  });
  it('refuses reset when no active entry remains', async () => {
    const { service, sqls } = fixture('ISSUED', false);
    await expect(service.reset(admin, eventId, userId, { reason })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sqls.some((s) => s.startsWith('INSERT INTO'))).toBe(false);
  });
});
