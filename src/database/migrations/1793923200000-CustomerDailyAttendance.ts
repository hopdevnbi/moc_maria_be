import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer check-ins share the existing transactional coin wallet/ledger.
 * RLS and revoked public access already apply to staff_check_ins.
 */
export class CustomerDailyAttendance1793923200000 implements MigrationInterface {
  name = 'CustomerDailyAttendance1793923200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff_check_ins"
        ADD COLUMN "checkin_category" varchar(12) NOT NULL DEFAULT 'STAFF',
        ADD COLUMN "customer_device_hash" char(64),
        ADD CONSTRAINT "chk_attendance_category"
          CHECK ("checkin_category" IN ('STAFF','CUSTOMER')),
        ADD CONSTRAINT "chk_customer_attendance_reward"
          CHECK ("checkin_category" <> 'CUSTOMER' OR
            ("customer_device_hash" IS NOT NULL AND "status" = 'IN_RANGE' AND "coins_earned" = 5))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_customer_checkin_device_date"
        ON "staff_check_ins" ("local_date", "customer_device_hash")
        WHERE "customer_device_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "uq_customer_checkin_device_date"');
    await queryRunner.query(
      'ALTER TABLE "staff_check_ins" DROP CONSTRAINT "chk_customer_attendance_reward"',
    );
    await queryRunner.query(
      'ALTER TABLE "staff_check_ins" DROP CONSTRAINT "chk_attendance_category"',
    );
    await queryRunner.query('ALTER TABLE "staff_check_ins" DROP COLUMN "customer_device_hash"');
    await queryRunner.query('ALTER TABLE "staff_check_ins" DROP COLUMN "checkin_category"');
  }
}
