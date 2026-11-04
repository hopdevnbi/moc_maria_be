import type { QueryRunner } from 'typeorm';
import { StaffAttendance1793836800000 } from './1793836800000-StaffAttendance';

describe('staff attendance migration access control', () => {
  it('enables RLS and revokes direct access from Supabase API roles and PUBLIC', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new StaffAttendance1793836800000().up(runner);

    const tables = ['staff_check_ins', 'staff_coin_wallets', 'staff_coin_ledger'];
    for (const table of tables) {
      const createPosition = queries.findIndex((sql) => sql.includes(`CREATE TABLE "${table}"`));
      const rlsStatement = `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`;
      const revokeStatement = `REVOKE ALL ON TABLE "${table}" FROM PUBLIC, anon, authenticated`;
      const rlsPosition = queries.indexOf(rlsStatement);
      const revokePosition = queries.indexOf(revokeStatement);

      expect(createPosition).toBeGreaterThanOrEqual(0);
      expect(rlsPosition).toBeGreaterThan(createPosition);
      expect(revokePosition).toBeGreaterThan(rlsPosition);
      expect(queries.filter((sql) => sql === rlsStatement)).toHaveLength(1);
      expect(queries.filter((sql) => sql === revokeStatement)).toHaveLength(1);
    }
    expect(queries.filter((sql) => sql.includes('CREATE POLICY'))).toHaveLength(0);
  });
});
