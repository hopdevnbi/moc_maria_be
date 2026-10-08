import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BranchBusinessHours1791523600000 implements MigrationInterface {
  name = 'BranchBusinessHours1791523600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "branch_business_hours" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE, "weekday" smallint NOT NULL, "opens_at_minute" smallint NOT NULL, "closes_at_minute" smallint NOT NULL, CONSTRAINT "chk_branch_hours_weekday" CHECK ("weekday" BETWEEN 0 AND 6), CONSTRAINT "chk_branch_hours_open" CHECK ("opens_at_minute" BETWEEN 0 AND 1439), CONSTRAINT "chk_branch_hours_close" CHECK ("closes_at_minute" BETWEEN 1 AND 1440), CONSTRAINT "chk_branch_hours_order" CHECK ("closes_at_minute" > "opens_at_minute"), CONSTRAINT "uq_branch_hours_weekday" UNIQUE ("branch_id", "weekday"))',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "branch_business_hours"');
  }
}
