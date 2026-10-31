import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserve historical draws/rewards while allowing one new active draw after reset. */
export class GiftEventPlayResets1792500000000 implements MigrationInterface {
  name = 'GiftEventPlayResets1792500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE gift_event_entries ADD COLUMN reset_at timestamptz');
    // Anonymous original UNIQUE constraints need discovery (names may be truncated by PG).
    await q.query(`DO $migration$
      DECLARE constraint_name text;
      BEGIN
        FOR constraint_name IN
          SELECT conname FROM pg_constraint
          WHERE conrelid='gift_event_entries'::regclass AND contype='u'
            AND conkey IN (ARRAY[2,3]::smallint[], ARRAY[2,3,4]::smallint[])
        LOOP
          EXECUTE format('ALTER TABLE gift_event_entries DROP CONSTRAINT %I',constraint_name);
        END LOOP;
      END $migration$`);
    await q.query(`CREATE UNIQUE INDEX uq_gift_event_active_customer
      ON gift_event_entries(event_id,customer_user_id) WHERE reset_at IS NULL`);
    await q.query(`CREATE UNIQUE INDEX uq_gift_event_active_idempotency
      ON gift_event_entries(event_id,customer_user_id,idempotency_key) WHERE reset_at IS NULL`);
    await q.query(`CREATE INDEX ix_gift_event_entries_reset_at
      ON gift_event_entries(event_id,reset_at,created_at DESC)`);
    await q.query(`CREATE TABLE gift_event_play_resets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES gift_event_campaigns(id) ON DELETE RESTRICT,
      entry_id uuid NOT NULL UNIQUE REFERENCES gift_event_entries(id) ON DELETE RESTRICT,
      reward_id uuid NOT NULL REFERENCES gift_event_rewards(id) ON DELETE RESTRICT,
      customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reason varchar(500) NOT NULL CHECK(length(btrim(reason)) >= 3),
      before_snapshot jsonb NOT NULL CHECK(jsonb_typeof(before_snapshot)='object'),
      after_snapshot jsonb NOT NULL CHECK(jsonb_typeof(after_snapshot)='object'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE INDEX ix_gift_play_resets_event_time
      ON gift_event_play_resets(event_id,created_at DESC)`);
    await q.query(`CREATE INDEX ix_gift_play_resets_customer_time
      ON gift_event_play_resets(customer_user_id,created_at DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    const [record] = (await q.query(`SELECT
      (SELECT COUNT(*) FROM gift_event_play_resets)
      + (SELECT COUNT(*) FROM gift_event_entries WHERE reset_at IS NOT NULL) AS n`)) as Array<{
      n: string;
    }>;
    if (Number(record?.n ?? 0) > 0)
      throw new Error('Cannot rollback GiftEventPlayResets: historical resets must be preserved.');
    await q.query('DROP TABLE gift_event_play_resets');
    await q.query('DROP INDEX ix_gift_event_entries_reset_at');
    await q.query('DROP INDEX uq_gift_event_active_idempotency');
    await q.query('DROP INDEX uq_gift_event_active_customer');
    await q.query('ALTER TABLE gift_event_entries DROP COLUMN reset_at');
    await q.query(`ALTER TABLE gift_event_entries
      ADD CONSTRAINT uq_gift_event_entry_customer UNIQUE(event_id,customer_user_id)`);
    await q.query(`ALTER TABLE gift_event_entries
      ADD CONSTRAINT uq_gift_event_entry_idempotency UNIQUE(event_id,customer_user_id,idempotency_key)`);
  }
}
