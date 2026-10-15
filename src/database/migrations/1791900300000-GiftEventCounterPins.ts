import type { MigrationInterface, QueryRunner } from 'typeorm';

/** V02: short-lived six-digit claim code; QR remains the primary alternative. */
export class GiftEventCounterPins1791900300000 implements MigrationInterface {
  name = 'GiftEventCounterPins1791900300000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE gift_event_counter_pins (
      reward_id uuid PRIMARY KEY REFERENCES gift_event_rewards(id) ON DELETE RESTRICT,
      pin_hash char(64) NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      'CREATE INDEX ix_gift_event_counter_pins_expiry ON gift_event_counter_pins(expires_at)',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE gift_event_counter_pins');
  }
}
