import type { MigrationInterface, QueryRunner } from 'typeorm';

/** P12: explicit user + branch grant. No automatic receptionist or KTV rights. */
export class GiftEventCounterAccess1791900100000 implements MigrationInterface {
  name = 'GiftEventCounterAccess1791900100000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE gift_event_counter_access (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(user_id,branch_id)
    )`);
    await q.query(
      'CREATE INDEX ix_gift_counter_branch ON gift_event_counter_access(branch_id,user_id)',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = (await q.query(
      'SELECT COUNT(*)::int AS n FROM gift_event_counter_access',
    )) as Array<{ n: number }>;
    if (Number(row?.n ?? 0) > 0)
      throw new Error('Cannot drop counter access with active staff grants.');
    await q.query('DROP TABLE gift_event_counter_access');
  }
}
