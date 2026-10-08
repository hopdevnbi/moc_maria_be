import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ResourceCategoryFoundation1791530800000 implements MigrationInterface {
  name = 'ResourceCategoryFoundation1791530800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "branch_resources" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE, "code" varchar(40) NOT NULL, "name" varchar(160) NOT NULL, "kind" varchar(24) NOT NULL, "capacity" smallint NOT NULL DEFAULT 1, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "uq_branch_resource_code" UNIQUE ("branch_id", "code"), CONSTRAINT "chk_resource_kind" CHECK ("kind" IN (\'ROOM\',\'EQUIPMENT\')), CONSTRAINT "chk_resource_capacity" CHECK ("capacity" BETWEEN 1 AND 100))',
    );
    await queryRunner.query(
      'CREATE TABLE "service_categories" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar(160) NOT NULL, "slug" varchar(100) NOT NULL UNIQUE, "description" text, "sort_order" integer NOT NULL DEFAULT 0, "is_published" boolean NOT NULL DEFAULT false, CONSTRAINT "chk_category_sort" CHECK ("sort_order" BETWEEN 0 AND 1000000))',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "service_categories"');
    await queryRunner.query('DROP TABLE IF EXISTS "branch_resources"');
  }
}
