import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import { GiftWalletService } from './gift-wallet.service';

const id = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const rewardId = '33333333-3333-4333-8333-333333333333';
const actor = {
  id,
  roles: ['CUSTOMER'],
  permissions: ['customer.portal'],
  isActive: true,
} as AuthUserContext;
const issuedAt = new Date('2026-10-15T00:00:00Z');
const future = new Date('2099-10-15T00:00:00Z');
const row = {
  id: rewardId,
  entry_id: '44444444-4444-4444-8444-444444444444',
  event_id: eventId,
  prize_id: '55555555-5555-4555-8555-555555555555',
  status: 'ISSUED',
  reward_snapshot: {
    name: 'Voucher chăm sóc 50.000₫',
    description: 'Một lời cảm ơn',
    kind: 'VOUCHER_FIXED',
    config: { valueVnd: 50000, validityDays: 30 },
    allowedBranchIds: ['66666666-6666-4666-8666-666666666666'],
    liabilityVnd: 50000,
    termsVersion: 1,
  },
  expires_at: future,
  issued_at: issuedAt,
  redeemed_at: null,
  redeemed_branch_id: null,
};

function mockWallet(rewards: (typeof row)[] = [row]): {
  service: GiftWalletService;
  queries: Array<{ sql: string; params: unknown[] }>;
} {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM gift_event_rewards') && sql.includes('WHERE id='))
      return Promise.resolve(rewards.filter((x) => x.id === params[0] && params[1] === actor.id));
    if (sql.includes('FROM gift_event_rewards') && sql.includes('WHERE customer_user_id='))
      return Promise.resolve(params[0] === actor.id ? rewards : []);
    if (sql.includes('FROM gift_event_rewards') && sql.includes('WHERE entry_id='))
      return Promise.resolve(
        rewards.filter((x) => x.entry_id === params[0] && params[1] === actor.id),
      );
    if (sql.includes('FROM gift_event_entries') && sql.includes('WHERE id='))
      return Promise.resolve(
        params[1] === actor.id
          ? [
              {
                id: row.entry_id,
                event_id: eventId,
                selected_box: 3,
                accepted_terms_version: 1,
                created_at: issuedAt,
              },
            ]
          : [],
      );
    if (sql.includes('FROM gift_event_rewards') && sql.includes('FOR UPDATE'))
      return Promise.resolve(rewards.filter((x) => x.id === params[0] && params[1] === actor.id));
    return Promise.resolve([]);
  });
  const db = {
    query,
    transaction: (fn: (m: EntityManager) => unknown) => fn({ query } as unknown as EntityManager),
  } as unknown as DataSource;
  return { service: new GiftWalletService(db, new GiftEventsService(db)), queries };
}
beforeEach(() => {
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
});
afterEach(() => delete process.env['GIFT_EVENTS_ENABLED']);

describe('P08 wallet and QR ownership', () => {
  it('blocks disabled feature and every inactive / non-customer account before DB', async () => {
    const { service, queries } = mockWallet();
    await expect(service.list({ ...actor, roles: ['ADMIN'] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.detail({ ...actor, isActive: false }, rewardId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(queries).toHaveLength(0);
  });
  it('returns owned rewards only, with snapshot terms and branch restrictions', async () => {
    const { service, queries } = mockWallet();
    const list = await service.list(actor);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: rewardId,
      status: 'ISSUED',
      name: 'Voucher chăm sóc 50.000₫',
      allowedBranchIds: ['66666666-6666-4666-8666-666666666666'],
    });
    expect(
      queries.some(
        (x) => x.sql.includes('WHERE customer_user_id=$1::uuid') && x.params[0] === actor.id,
      ),
    ).toBe(true);
  });
  it('never discloses rewards owned by another account even with a guessed id', async () => {
    const { service } = mockWallet([]);
    await expect(service.detail(actor, rewardId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.issueQr(actor, rewardId)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('shows expired when time has passed, without altering original snapshot', async () => {
    const { service } = mockWallet([{ ...row, expires_at: new Date('2020-01-01T00:00:00Z') }]);
    const data = await service.detail(actor, rewardId);
    expect(data).toMatchObject({ status: 'EXPIRED', name: row.reward_snapshot.name });
    await expect(service.issueQr(actor, rewardId)).rejects.toBeInstanceOf(ConflictException);
  });
  it('generates an opaque 256-bit QR secret, saves only SHA-256, and limits TTL to five minutes', async () => {
    const { service, queries } = mockWallet();
    const first = await service.issueQr(actor, rewardId);
    expect(first.rewardId).toBe(rewardId);
    expect(first.token).toMatch(/^[\w-]{40,50}$/);
    const sql = queries.find((x) => x.sql.includes('INSERT INTO gift_event_qr_tokens'));
    expect(sql?.params[0]).toBe(rewardId);
    expect(sql?.params[1]).toBe(createHash('sha256').update(first.token).digest('hex'));
    expect(JSON.stringify(queries)).not.toContain(first.token);
    const ttlMs = new Date(first.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000);
    const second = await service.issueQr(actor, rewardId);
    expect(second.token).not.toBe(first.token);
    expect(queries.filter((x) => x.sql.includes('ON CONFLICT(reward_id)'))).toHaveLength(2);
  });
  it('refuses QR issuance for redeemed reward and does not write a token', async () => {
    const { service, queries } = mockWallet([{ ...row, status: 'REDEEMED' }]);
    await expect(service.issueQr(actor, rewardId)).rejects.toBeInstanceOf(ConflictException);
    expect(queries.find((x) => x.sql.includes('INSERT INTO gift_event_qr_tokens'))).toBeUndefined();
  });
  it('recovers open result from recorded entry without another draw', async () => {
    const { service, queries } = mockWallet();
    const result = await service.openResult(actor, row.entry_id);
    expect(result).toMatchObject({ boxId: 3, reward: { id: rewardId, status: 'ISSUED' } });
    expect(queries.some((x) => x.sql.includes('UPDATE gift_event_prizes'))).toBe(false);
  });
});
