import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P04 — Gift-event schema. Additive, never edits booking, loyalty, catalog or
 * customer tables. No live event/stock rows are seeded. Down refuses to remove
 * issued rights or campaigns with real business data.
 */
export class GiftEventFoundation1791900000000 implements MigrationInterface {
  name = 'GiftEventFoundation1791900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE gift_event_campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(60) NOT NULL UNIQUE,
      slug varchar(80) NOT NULL UNIQUE,
      title varchar(160) NOT NULL,
      description text NOT NULL DEFAULT '',
      hero_url varchar(2048),
      terms_text text NOT NULL DEFAULT '',
      terms_version integer NOT NULL DEFAULT 1 CHECK(terms_version > 0),
      status varchar(12) NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','SCHEDULED','LIVE','PAUSED','ENDED','ARCHIVED')),
      start_at timestamptz,
      end_at timestamptz,
      timezone varchar(60) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
      guarantee_prize boolean NOT NULL DEFAULT true CHECK(guarantee_prize),
      max_opens_per_user smallint NOT NULL DEFAULT 1 CHECK(max_opens_per_user = 1),
      budget_cap_vnd bigint NOT NULL DEFAULT 0 CHECK(budget_cap_vnd >= 0),
      budget_reserved_vnd bigint NOT NULL DEFAULT 0 CHECK(budget_reserved_vnd >= 0 AND budget_reserved_vnd <= budget_cap_vnd),
      pause_reason varchar(500),
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT gift_event_time_window CHECK(
        (start_at IS NULL AND end_at IS NULL)
        OR (start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at)
      )
    )`);
    await q.query(`CREATE INDEX ix_gift_event_status_time
      ON gift_event_campaigns(status,start_at,end_at)`);
    await q.query(`CREATE TABLE gift_event_tiers (
      event_id uuid NOT NULL REFERENCES gift_event_campaigns(id) ON DELETE RESTRICT,
      tier_code varchar(12) NOT NULL
        CHECK(tier_code = 'STANDARD' OR tier_code ~ '^VIP([1-9]|[1-9][0-9])$'),
      PRIMARY KEY(event_id,tier_code)
    )`);
    await q.query(`CREATE TABLE gift_event_prizes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES gift_event_campaigns(id) ON DELETE RESTRICT,
      name varchar(160) NOT NULL,
      description varchar(1200) NOT NULL DEFAULT '',
      kind varchar(25) NOT NULL CHECK(kind IN
        ('VOUCHER_FIXED','VOUCHER_PERCENT','GIFT_CARD','PHYSICAL_ITEM','TAKEAWAY_DRINK','CASH_COUNTER')),
      config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(config)='object'),
      weight integer NOT NULL CHECK(weight BETWEEN 1 AND 100000),
      stock_total integer NOT NULL CHECK(stock_total BETWEEN 0 AND 1000000),
      stock_issued integer NOT NULL DEFAULT 0 CHECK(stock_issued >= 0 AND stock_issued <= stock_total),
      liability_vnd bigint NOT NULL CHECK(liability_vnd >= 0),
      enabled boolean NOT NULL DEFAULT false,
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE INDEX ix_gift_prizes_event_available
      ON gift_event_prizes(event_id,enabled,stock_issued,stock_total)`);
    await q.query(`CREATE TABLE gift_event_prize_branches (
      prize_id uuid NOT NULL REFERENCES gift_event_prizes(id) ON DELETE RESTRICT,
      branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      PRIMARY KEY(prize_id,branch_id)
    )`);
    await q.query(`CREATE TABLE gift_event_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES gift_event_campaigns(id) ON DELETE RESTRICT,
      customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      idempotency_key varchar(90) NOT NULL CHECK(length(idempotency_key) BETWEEN 12 AND 90),
      request_fingerprint char(64) NOT NULL,
      selected_box smallint NOT NULL CHECK(selected_box BETWEEN 1 AND 6),
      accepted_terms_version integer NOT NULL CHECK(accepted_terms_version > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(event_id,customer_user_id),
      UNIQUE(event_id,customer_user_id,idempotency_key)
    )`);
    await q.query(
      `CREATE INDEX ix_gift_entries_user ON gift_event_entries(customer_user_id,created_at DESC)`,
    );
    await q.query(`CREATE TABLE gift_event_rewards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_id uuid NOT NULL UNIQUE REFERENCES gift_event_entries(id) ON DELETE RESTRICT,
      event_id uuid NOT NULL REFERENCES gift_event_campaigns(id) ON DELETE RESTRICT,
      prize_id uuid NOT NULL REFERENCES gift_event_prizes(id) ON DELETE RESTRICT,
      customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reward_snapshot jsonb NOT NULL CHECK(jsonb_typeof(reward_snapshot)='object'),
      status varchar(12) NOT NULL DEFAULT 'ISSUED'
        CHECK(status IN ('ISSUED','REDEEMED','EXPIRED','VOIDED')),
      issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL,
      redeemed_at timestamptz,
      redeemed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      redeemed_branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      CONSTRAINT gift_reward_redemption_consistency CHECK(
        (status='REDEEMED' AND redeemed_at IS NOT NULL AND redeemed_by IS NOT NULL AND redeemed_branch_id IS NOT NULL)
        OR (status <> 'REDEEMED' AND redeemed_at IS NULL AND redeemed_by IS NULL AND redeemed_branch_id IS NULL)
      ),
      CONSTRAINT gift_reward_expiry CHECK(expires_at > issued_at)
    )`);
    await q.query(
      `CREATE INDEX ix_gift_rewards_user ON gift_event_rewards(customer_user_id,issued_at DESC)`,
    );
    await q.query(
      `CREATE INDEX ix_gift_rewards_event_status ON gift_event_rewards(event_id,status,expires_at)`,
    );
    await q.query(`CREATE TABLE gift_event_qr_tokens (
      reward_id uuid PRIMARY KEY REFERENCES gift_event_rewards(id) ON DELETE RESTRICT,
      token_hash char(64) NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE TABLE gift_event_redemption_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reward_id uuid NOT NULL REFERENCES gift_event_rewards(id) ON DELETE RESTRICT,
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
      action varchar(24) NOT NULL CHECK(action IN ('VERIFY','REDEEM','REVOKE','EXPIRE')),
      reason varchar(500) NOT NULL DEFAULT '',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE INDEX ix_gift_redemption_reward
      ON gift_event_redemption_history(reward_id,created_at DESC)`);
    await q.query(`CREATE TABLE gift_event_admin_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES gift_event_campaigns(id) ON DELETE RESTRICT,
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action varchar(80) NOT NULL,
      reason varchar(500) NOT NULL,
      before_snapshot jsonb,
      after_snapshot jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE INDEX ix_gift_event_audit_time
      ON gift_event_admin_audit(event_id,created_at DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Safe only for an EMPTY installation: refuse irreversible campaign or
    // reward loss, even on manual rollback request.
    const [row] = (await q.query('SELECT COUNT(*)::int AS n FROM gift_event_campaigns')) as Array<{
      n: number;
    }>;
    if (Number(row?.n ?? 0) !== 0) {
      throw new Error(
        'Cannot rollback GiftEventFoundation: campaigns exist. Archive or migrate business data first.',
      );
    }
    for (const table of [
      'gift_event_admin_audit',
      'gift_event_redemption_history',
      'gift_event_qr_tokens',
      'gift_event_rewards',
      'gift_event_entries',
      'gift_event_prize_branches',
      'gift_event_prizes',
      'gift_event_tiers',
      'gift_event_campaigns',
    ]) {
      await q.query('DROP TABLE ' + table);
    }
  }
}
