import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ServiceCatalogPricing1791534400000 implements MigrationInterface {
  name = 'ServiceCatalogPricing1791534400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "services" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "category_id" uuid NOT NULL REFERENCES "service_categories"("id") ON DELETE RESTRICT, "name" varchar(160) NOT NULL, "slug" varchar(120) NOT NULL UNIQUE, "description" text, "is_published" boolean NOT NULL DEFAULT false)',
    );
    await q.query(
      'CREATE TABLE "service_variants" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE RESTRICT, "name" varchar(160) NOT NULL, "duration_minutes" integer NOT NULL, "price_vnd" bigint NOT NULL, "buffer_before_minutes" integer NOT NULL DEFAULT 0, "buffer_after_minutes" integer NOT NULL DEFAULT 0, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "chk_variant_duration" CHECK ("duration_minutes" BETWEEN 5 AND 1440), CONSTRAINT "chk_variant_price" CHECK ("price_vnd" BETWEEN 0 AND 100000000000), CONSTRAINT "chk_variant_buffers" CHECK ("buffer_before_minutes" BETWEEN 0 AND 240 AND "buffer_after_minutes" BETWEEN 0 AND 240))',
    );
    await q.query(
      'CREATE TABLE "branch_services" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE, "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE, "is_active" boolean NOT NULL DEFAULT true, "price_override_vnd" bigint, CONSTRAINT "uq_branch_service" UNIQUE ("branch_id", "service_id"), CONSTRAINT "chk_branch_service_price" CHECK ("price_override_vnd" IS NULL OR "price_override_vnd" BETWEEN 0 AND 100000000000))',
    );
    await q.query('CREATE INDEX "idx_variants_service" ON "service_variants" ("service_id")');
    await q.query('CREATE INDEX "idx_branch_services_service" ON "branch_services" ("service_id")');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "branch_services"');
    await q.query('DROP TABLE IF EXISTS "service_variants"');
    await q.query('DROP TABLE IF EXISTS "services"');
  }
}
