import type { QueryRunner } from 'typeorm';
import { GiftEventFoundation1791900000000 } from './1791900000000-GiftEventFoundation';

describe('P04 gift-event migration safety', () => {
  it('creates isolated event tables, database-level stock/budget checks and idempotency', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new GiftEventFoundation1791900000000().up(runner);
    const joined = statements.join('\n');
    expect(statements.filter((sql) => sql.startsWith('CREATE TABLE'))).toHaveLength(9);
    expect(joined).toContain('stock_issued <= stock_total');
    expect(joined).toContain('budget_reserved_vnd <= budget_cap_vnd');
    expect(joined).toContain('UNIQUE(event_id,customer_user_id)');
    expect(joined).toContain('UNIQUE(event_id,customer_user_id,idempotency_key)');
    expect(joined).toContain('UNIQUE REFERENCES gift_event_entries');
    expect(joined).toContain("status IN ('ISSUED','REDEEMED','EXPIRED','VOIDED')");
    expect(joined).toContain('BETWEEN 1 AND 6');
    expect(joined).not.toMatch(/ALTER TABLE (appointments|users|customers)/i);
  });

  it('refuses data-destructive rollback and only drops empty isolated event tables', async () => {
    const runnerWithData = {
      query: jest.fn().mockResolvedValue([{ n: 1 }]),
    } as unknown as QueryRunner;
    await expect(new GiftEventFoundation1791900000000().down(runnerWithData)).rejects.toThrow(
      'campaigns exist',
    );
    expect((runnerWithData.query as jest.Mock).mock.calls).toHaveLength(1);
    const statements: string[] = [];
    const empty = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve(sql.startsWith('SELECT') ? [{ n: 0 }] : []);
      }),
    } as unknown as QueryRunner;
    await new GiftEventFoundation1791900000000().down(empty);
    expect(statements.filter((s) => s.startsWith('DROP TABLE'))).toHaveLength(9);
    expect(statements.join(' ')).not.toContain('DROP TABLE appointments');
  });
});
