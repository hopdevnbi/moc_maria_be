import type { EntityManager } from 'typeorm';
import { hasCompletedGiftService } from './gift-service-eligibility';

describe('Event service-use prerequisite', () => {
  const customer = '11111111-1111-4111-8111-111111111111';
  it('recognizes a confirmed prior completed service only by the same customer ID', async () => {
    const query = jest.fn().mockResolvedValue([{ completed: true }]);
    await expect(
      hasCompletedGiftService({ query } as unknown as EntityManager, customer),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("a.status='COMPLETED'"), [customer]);
    expect(query.mock.calls[0][0]).toContain("m.value->>'customerId'=$1::text");
  });
  it('does not grant eligibility for a pending/unconfirmed service', async () => {
    const query = jest.fn().mockResolvedValue([{ completed: false }]);
    await expect(
      hasCompletedGiftService({ query } as unknown as EntityManager, customer),
    ).resolves.toBe(false);
  });
  it('denies when a row cannot be found', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(
      hasCompletedGiftService({ query } as unknown as EntityManager, customer),
    ).resolves.toBe(false);
  });
});
