import type { QueryRunner } from 'typeorm';
import { GiftEventPlayResets1792500000000 } from './1792500000000-GiftEventPlayResets';

describe('GiftEventPlayResets migration', () => {
  it('replaces both original uniqueness constraints with active-entry partial indexes', async () => {
    const statements: string[] = [];
    const q = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new GiftEventPlayResets1792500000000().up(q);
    expect(statements.join('\n')).toContain(
      'conkey IN (ARRAY[2,3]::smallint[], ARRAY[2,3,4]::smallint[])',
    );
    expect(statements.join('\n')).toContain('uq_gift_event_active_customer');
    expect(statements.join('\n')).toContain('uq_gift_event_active_idempotency');
    expect(statements.join('\n')).toContain('WHERE reset_at IS NULL');
    expect(statements.join('\n')).toContain('CREATE TABLE gift_event_play_resets');
  });

  it('refuses rollback when historical reset rows exist', async () => {
    const mockQuery = jest.fn().mockResolvedValue([{ n: '1' }]);
    const q = { query: mockQuery } as unknown as QueryRunner;
    await expect(new GiftEventPlayResets1792500000000().down(q)).rejects.toThrow(
      'historical resets must be preserved',
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
