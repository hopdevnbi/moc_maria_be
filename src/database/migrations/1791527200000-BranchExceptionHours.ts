import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BranchExceptionHours1791527200000 implements MigrationInterface {
  name = 'BranchExceptionHours1791527200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "branch_exception_hours" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE, "date" date NOT NULL, "is_closed" boolean NOT NULL DEFAULT true, "opens_at_minute" smallint, "closes_at_minute" smallint, "note" varchar(240), CONSTRAINT "uq_branch_exception_date" UNIQUE ("branch_id", "date"), CONSTRAINT "chk_branch_exception_times" CHECK (("is_closed" = true AND "opens_at_minute" IS NULL AND "closes_at_minute" IS NULL) OR ("is_closed" = false AND "opens_at_minute" BETWEEN 0 AND 1439 AND "closes_at_minute" BETWEEN 1 AND 1440 AND "closes_at_minute" > "opens_at_minute")))',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "branch_exception_hours"');
  }
}
