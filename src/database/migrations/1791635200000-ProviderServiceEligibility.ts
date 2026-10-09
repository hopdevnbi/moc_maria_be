import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderServiceEligibility1791635200000 implements MigrationInterface {
  name = 'ProviderServiceEligibility1791635200000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE provider_public_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL UNIQUE REFERENCES provider_applications(id) ON DELETE CASCADE,
      slug varchar(120) NOT NULL UNIQUE, title varchar(120) NOT NULL,
      years_experience smallint CHECK(years_experience BETWEEN 0 AND 60),
      is_published boolean NOT NULL DEFAULT false,
      reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE provider_operating_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL UNIQUE REFERENCES provider_applications(id) ON DELETE CASCADE,
      provider_kind varchar(16) NOT NULL CHECK(provider_kind IN ('WELLNESS','SPECIALIST')),
      quality_status varchar(16) NOT NULL CHECK(quality_status IN ('ACTIVE','WATCHLIST','PAUSED','SUSPENDED')),
      reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE service_provider_policies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      course_id uuid NOT NULL REFERENCES provider_training_courses(id) ON DELETE RESTRICT,
      mode varchar(16) NOT NULL CHECK(mode IN ('ON_SITE','AT_HOME')),
      jurisdiction_code varchar(64) NOT NULL, territory_label varchar(120) NOT NULL,
      legal_requirement varchar(24) NOT NULL CHECK(legal_requirement IN ('LICENSE_REQUIRED','NOT_REQUIRED')),
      legal_review_reference varchar(100) NOT NULL, valid_until timestamptz NOT NULL,
      is_active boolean NOT NULL DEFAULT false,
      reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_service_provider_policy_scope UNIQUE(service_id,branch_id,mode,jurisdiction_code))`);
    await q.query(`CREATE TABLE provider_service_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      policy_id uuid NOT NULL REFERENCES service_provider_policies(id) ON DELETE RESTRICT,
      credential_reference varchar(100), credential_valid_until timestamptz,
      travel_buffer_minutes smallint NOT NULL CHECK(travel_buffer_minutes BETWEEN 0 AND 240),
      travel_fee_vnd bigint NOT NULL CHECK(travel_fee_vnd BETWEEN 0 AND 100000000),
      max_radius_km smallint CHECK(max_radius_km BETWEEN 1 AND 500),
      is_active boolean NOT NULL DEFAULT false,
      reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_provider_service_grant_policy UNIQUE(provider_application_id,policy_id))`);
    // No inferred consent, legal clearance, quality activation, territory or published profile.
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE provider_service_grants');
    await q.query('DROP TABLE service_provider_policies');
    await q.query('DROP TABLE provider_operating_reviews');
    await q.query('DROP TABLE provider_public_profiles');
  }
}
