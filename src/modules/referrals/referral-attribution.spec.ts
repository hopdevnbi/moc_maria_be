import { deviceSignal, recordReferral, riskFor } from './referral-attribution';
import type { EntityManager } from 'typeorm';
import { assertReferralAdmin } from './referrals.service';
import type { AuthUserContext } from '../identity/identity.types';

describe('referral advisory signals', () => {
  it('does not infer identity from browser evidence', () => {
    expect(riskFor(true, true)).toEqual({
      score: 60,
      flags: ['SHARED_BROWSER', 'HIGH_REFERRAL_VELOCITY'],
    });
    expect(riskFor(false, false)).toEqual({ score: 0, flags: [] });
  });
  it('omits missing or malformed evidence and requires a separate secret', () => {
    const device = 'a4facc87-9375-43f4-a5dc-6f879b7ab069';
    expect(deviceSignal(device, '')).toBeNull();
    expect(deviceSignal('invalid', 'x'.repeat(32))).toBeNull();
    expect(deviceSignal(device, 'x'.repeat(32))).toMatch(/^[a-f0-9]{64}$/);
    expect(deviceSignal(device, 'x'.repeat(32))).not.toEqual(deviceSignal(device, 'y'.repeat(32)));
  });
  it('records high-risk attribution exactly as pending; never rejects by score', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ user_id: 'referrer', reward_coins: 100 }])
      .mockResolvedValueOnce([{ shared: true, velocity: true }])
      .mockResolvedValueOnce([]);
    await recordReferral({ query } as unknown as EntityManager, 'new-user', 'A'.repeat(20));
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[2][0]).toContain('ON CONFLICT(referred_id) DO NOTHING');
    expect(calls[2][1]).toEqual([
      'referrer',
      'new-user',
      100,
      60,
      JSON.stringify(['SHARED_BROWSER', 'HIGH_REFERRAL_VELOCITY']),
      null,
      null,
    ]);
  });
  it('ignores malformed or unknown codes without blocking registration', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const m = { query } as unknown as EntityManager;
    await recordReferral(m, 'new-user', 'invalid');
    expect(query).not.toHaveBeenCalled();
    await recordReferral(m, 'new-user', 'A'.repeat(20));
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each(['ADMIN', 'CUSTOMER', 'THERAPIST'])('denies admin data for %s', (role) => {
    expect(() =>
      assertReferralAdmin({
        isActive: true,
        roles: [role],
        permissions: ['admin.portal'],
      } as AuthUserContext),
    ).toThrow();
  });
});
