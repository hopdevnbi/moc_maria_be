import type { QueryRunner } from 'typeorm';
import { CustomerDailyAttendance1793923200000 } from './1793923200000-CustomerDailyAttendance';

describe('customer attendance migration security', () => {
  it('reuses private attendance tables and enforces one browser identifier per day at DB level', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };
    await new CustomerDailyAttendance1793923200000().up(runner as unknown as QueryRunner);
    const sql = queries.join(' ');
    expect(sql).toContain('"customer_device_hash"');
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_customer_checkin_device_date"');
    expect(sql).toContain('WHERE "customer_device_hash" IS NOT NULL');
    expect(sql).toContain('"checkin_category"');
    expect(sql).toContain('"coins_earned" = 5');
    expect(sql).not.toMatch(/CREATE TABLE|DISABLE ROW LEVEL SECURITY|GRANT .* TO PUBLIC/i);
  });
});
