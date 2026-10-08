import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderTraining1791541600000 implements MigrationInterface {
  name = 'ProviderTraining1791541600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "provider_training_courses" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "code" varchar(80) NOT NULL UNIQUE, "title" varchar(180) NOT NULL, "description" varchar(1500), "is_active" boolean NOT NULL DEFAULT true)',
    );
    await q.query(
      'CREATE TABLE "provider_training_enrollments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "provider_application_id" uuid NOT NULL REFERENCES "provider_applications"("id") ON DELETE CASCADE, "course_id" uuid NOT NULL REFERENCES "provider_training_courses"("id") ON DELETE RESTRICT, "status" varchar(16) NOT NULL DEFAULT \'ENROLLED\', "attendance_percent" smallint NOT NULL DEFAULT 0, "assessment_passed" boolean NOT NULL DEFAULT false, "assessed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL, "assessed_at" timestamptz, CONSTRAINT "uq_provider_course_enrollment" UNIQUE ("provider_application_id", "course_id"), CONSTRAINT "chk_training_status" CHECK ("status" IN (\'ENROLLED\',\'IN_PROGRESS\',\'COMPLETED\',\'FAILED\')), CONSTRAINT "chk_attendance" CHECK ("attendance_percent" BETWEEN 0 AND 100))',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "provider_training_enrollments"');
    await q.query('DROP TABLE IF EXISTS "provider_training_courses"');
  }
}
