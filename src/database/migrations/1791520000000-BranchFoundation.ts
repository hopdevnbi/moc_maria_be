import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BranchFoundation1791520000000 implements MigrationInterface {
  name = 'BranchFoundation1791520000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "branches" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar(160) NOT NULL, "code" varchar(64) NOT NULL UNIQUE, "address" varchar(500) NOT NULL, "phone" varchar(32), "latitude" double precision, "longitude" double precision, "is_active" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "chk_branches_latitude" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90), CONSTRAINT "chk_branches_longitude" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180))',
    );
    await queryRunner.query('CREATE INDEX "idx_branches_active" ON "branches" ("is_active")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "branches"');
  }
}
