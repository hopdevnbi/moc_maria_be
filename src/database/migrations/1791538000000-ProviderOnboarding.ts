import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderOnboarding1791538000000 implements MigrationInterface {
  name = 'ProviderOnboarding1791538000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "provider_applications" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE, "public_name" varchar(160) NOT NULL, "introduction" varchar(500), "service_area" varchar(160), "status" varchar(24) NOT NULL DEFAULT \'APPLIED\', "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL, "review_note" varchar(500), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "chk_provider_application_status" CHECK ("status" IN (\'APPLIED\',\'REVIEWING\',\'TRAINING\',\'ASSESSMENT\',\'APPROVED\',\'REJECTED\',\'SUSPENDED\')))',
    );
    await q.query(
      'CREATE TABLE "provider_training_certificates" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "provider_application_id" uuid NOT NULL REFERENCES "provider_applications"("id") ON DELETE CASCADE, "course_code" varchar(80) NOT NULL, "title" varchar(160) NOT NULL, "certificate_number" varchar(60) NOT NULL UNIQUE, "issued_at" timestamptz NOT NULL, "expires_at" timestamptz, "revoked_at" timestamptz, "issued_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT, CONSTRAINT "uq_training_provider_course" UNIQUE ("provider_application_id", "course_code"), CONSTRAINT "chk_certificate_expiry" CHECK ("expires_at" IS NULL OR "expires_at" > "issued_at"))',
    );
    await q.query('CREATE INDEX "idx_provider_approved" ON "provider_applications" ("status")');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "provider_training_certificates"');
    await q.query('DROP TABLE IF EXISTS "provider_applications"');
  }
}
