import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffAttendance1793836800000 implements MigrationInterface {
  name = 'StaffAttendance1793836800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "staff_check_ins" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "local_date" date NOT NULL,
        "latitude" double precision,
        "longitude" double precision,
        "accuracy_meters" double precision,
        "distance_meters" double precision,
        "status" varchar(40) NOT NULL,
        "coins_earned" integer NOT NULL DEFAULT 0,
        "selfie_url" varchar(2048),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_staff_check_ins" PRIMARY KEY ("id"),
        CONSTRAINT "uq_staff_checkin_user_local_date" UNIQUE ("user_id", "local_date"),
        CONSTRAINT "fk_staff_checkins_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_staff_checkins_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_staff_checkins_latitude" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
        CONSTRAINT "chk_staff_checkins_longitude" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
        CONSTRAINT "chk_staff_checkins_accuracy" CHECK ("accuracy_meters" IS NULL OR "accuracy_meters" BETWEEN 0 AND 100000),
        CONSTRAINT "chk_staff_checkins_status" CHECK ("status" IN ('IN_RANGE','OUT_OF_RANGE','LOCATION_NOT_CONFIGURED','LOCATION_UNAVAILABLE')),
        CONSTRAINT "chk_staff_checkins_coin" CHECK ("coins_earned" IN (0,5)),
        CONSTRAINT "chk_staff_checkins_qualified" CHECK ("status" = 'IN_RANGE' OR "coins_earned" = 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_staff_checkins_date_branch" ON "staff_check_ins" ("local_date", "branch_id", "created_at" DESC)',
    );
    await queryRunner.query(`
      CREATE TABLE "staff_coin_wallets" (
        "user_id" uuid NOT NULL PRIMARY KEY REFERENCES "users"("id") ON DELETE RESTRICT,
        "balance" integer NOT NULL DEFAULT 0,
        "total_earned" integer NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_staff_coin_wallet_balance" CHECK ("balance" >= 0),
        CONSTRAINT "chk_staff_coin_wallet_total" CHECK ("total_earned" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "staff_coin_ledger" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "check_in_id" uuid NOT NULL UNIQUE REFERENCES "staff_check_ins"("id") ON DELETE RESTRICT,
        "amount" integer NOT NULL,
        "reason" varchar(32) NOT NULL DEFAULT 'CHECK_IN',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_staff_coin_ledger_positive" CHECK ("amount" > 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_staff_coin_ledger_user_created" ON "staff_coin_ledger" ("user_id", "created_at" DESC)',
    );

    // Staff location, selfie, and wallet data must not be exposed via Supabase Data API.
    // The backend connects as the table owner or a role with BYPASSRLS.
    for (const table of ['staff_check_ins', 'staff_coin_wallets', 'staff_coin_ledger']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      // PUBLIC includes every DB role; REVOKE does not affect ownership rights.
      await queryRunner.query(`REVOKE ALL ON TABLE "${table}" FROM PUBLIC, anon, authenticated`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "staff_coin_ledger"');
    await queryRunner.query('DROP TABLE IF EXISTS "staff_coin_wallets"');
    await queryRunner.query('DROP TABLE IF EXISTS "staff_check_ins"');
  }
}
