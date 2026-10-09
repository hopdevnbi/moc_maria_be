import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderSkillsSchedule1791631600000 implements MigrationInterface {
  name = 'ProviderSkillsSchedule1791631600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE provider_skills (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      certificate_id uuid NOT NULL REFERENCES provider_training_certificates(id) ON DELETE RESTRICT,
      is_active boolean NOT NULL DEFAULT true,
      reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_provider_skill_service UNIQUE(provider_application_id,service_id))`);
    await q.query(`CREATE TABLE provider_branch_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      is_active boolean NOT NULL DEFAULT true,
      CONSTRAINT uq_provider_branch_assignment UNIQUE(provider_application_id,branch_id))`);
    await q.query(`CREATE TABLE provider_weekly_shifts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6),
      starts_at_minute smallint NOT NULL, ends_at_minute smallint NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      CHECK(starts_at_minute>=0 AND ends_at_minute<=1440 AND starts_at_minute<ends_at_minute))`);
    await q.query(`CREATE INDEX idx_provider_weekly_active ON provider_weekly_shifts
      (provider_application_id,weekday) WHERE is_active=true`);
    await q.query(`CREATE TABLE provider_date_schedules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
      date date NOT NULL, kind varchar(16) NOT NULL CHECK(kind IN ('OVERRIDE','TIME_OFF')),
      starts_at_minute smallint NOT NULL, ends_at_minute smallint NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      CHECK(starts_at_minute>=0 AND ends_at_minute<=1440 AND starts_at_minute<ends_at_minute),
      CHECK((kind='OVERRIDE' AND branch_id IS NOT NULL) OR (kind='TIME_OFF' AND branch_id IS NULL)))`);
    await q.query(`CREATE INDEX idx_provider_date_active ON provider_date_schedules
      (provider_application_id,date) WHERE is_active=true`);
    // No implicit service skills, shifts or branch assignments for existing applicants.
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE provider_date_schedules');
    await q.query('DROP TABLE provider_weekly_shifts');
    await q.query('DROP TABLE provider_branch_assignments');
    await q.query('DROP TABLE provider_skills');
  }
}
