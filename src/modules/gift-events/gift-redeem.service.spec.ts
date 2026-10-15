import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import { GiftRedeemService } from './gift-redeem.service';

const branchId = '11111111-1111-4111-8111-111111111111';
const rewardId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const token = 'Q'.repeat(43);
const user = {
  id: '44444444-4444-4444-8444-444444444444',
  roles: ['SUPER_ADMIN'],
  permissions: ['admin.portal'],
  isActive: true,
  mustChangePassword: false,
} as AuthUserContext;

function scenario(): { service: GiftRedeemService; writes: () => number } {
  let redeemed = false,
    count = 0,
    hasHistory = false;
  let completedKey: unknown = null;
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM branches WHERE id=')) return Promise.resolve([{ id: branchId }]);
    if (sql.includes('WHERE token_hash=$1') && !sql.includes('JOIN gift_event_rewards'))
      return Promise.resolve([{ reward_id: rewardId }]);
    if (sql.includes('WHERE id=$1::uuid FOR UPDATE') && sql.includes('gift_event_rewards'))
      return Promise.resolve([
        {
          id: rewardId,
          event_id: eventId,
          reward_snapshot: {
            name: 'Voucher',
            kind: 'VOUCHER_FIXED',
            allowedBranchIds: [branchId],
          },
          status: redeemed ? 'REDEEMED' : 'ISSUED',
          expires_at: new Date('2099-01-01'),
          redeemed_at: redeemed ? new Date('2026-10-15') : null,
        },
      ]);
    if (sql.includes('FROM gift_event_qr_tokens WHERE reward_id='))
      return Promise.resolve([
        {
          reward_id: rewardId,
          token_hash: createHash('sha256').update(token).digest('hex'),
          expires_at: new Date('2099-01-01'),
        },
      ]);
    if (sql.includes('FROM gift_event_redemption_history'))
      return Promise.resolve(hasHistory && params[3] === completedKey ? [{ id: 'logged' }] : []);
    if (sql.includes('UPDATE gift_event_rewards')) {
      redeemed = true;
      count++;
      return Promise.resolve([{ redeemed_at: new Date('2026-10-15') }]);
    }
    if (sql.includes('INSERT INTO gift_event_redemption_history')) {
      hasHistory = true;
      completedKey = (JSON.parse(String(params[3])) as { idempotencyKey: string }).idempotencyKey;
    }
    return Promise.resolve([]);
  });
  const db = {
    query,
    manager: { query },
    transaction: (cb: (manager: EntityManager) => unknown) =>
      cb({ query } as unknown as EntityManager),
  } as unknown as DataSource;
  return { service: new GiftRedeemService(db, new GiftEventsService(db)), writes: () => count };
}
const dto = { token, branchId, idempotencyKey: 'gift-claim-unique-2026' };
beforeEach(() => {
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
});
afterEach(() => delete process.env['GIFT_EVENTS_ENABLED']);

describe('P12 one-time counter verification', () => {
  it('uses a transaction and idempotency to redeem only once', async () => {
    const { service, writes } = scenario();
    const first = await service.redeem(user, dto);
    const second = await service.redeem(user, dto);
    expect(first).toMatchObject({ status: 'REDEEMED', alreadyProcessed: false });
    expect(second).toMatchObject({ status: 'REDEEMED', alreadyProcessed: true });
    expect(writes()).toBe(1);
  });
  it('rejects a different retry key after the prize was claimed', async () => {
    const { service, writes } = scenario();
    await service.redeem(user, dto);
    await expect(
      service.redeem(user, { ...dto, idempotencyKey: 'different-claim-2026' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes()).toBe(1);
  });
  it('denies a receptionist without a Super Admin branch grant', async () => {
    const { service, writes } = scenario();
    await expect(
      service.redeem({ ...user, roles: ['RECEPTIONIST'], permissions: ['staff.portal'] }, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes()).toBe(0);
  });
});
