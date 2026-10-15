import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Isolated P14 fixed-window limiter; no global auth, checkout or booking changes. */
export class GiftEventRateLimits1791900200000 implements MigrationInterface {
  name = 'GiftEventRateLimits1791900200000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE gift_event_rate_limits (
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action varchar(40) NOT NULL,
      scope varchar(100) NOT NULL,
      window_start bigint NOT NULL,
      attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 100000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(actor_user_id,action,scope,window_start)
    )`);
    await q.query('CREATE INDEX ix_gift_rate_limits_created ON gift_event_rate_limits(created_at)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE gift_event_rate_limits');
  }
}
