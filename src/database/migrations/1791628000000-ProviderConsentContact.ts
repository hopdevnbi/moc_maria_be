import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderConsentContact1791628000000 implements MigrationInterface {
  name = 'ProviderConsentContact1791628000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE provider_consents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      scope varchar(32) NOT NULL CHECK (scope IN ('APPLICATION_REVIEW','PUBLIC_PROFILE')),
      version varchar(60) NOT NULL, granted boolean NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(provider_application_id, scope))`);
    await q.query(`CREATE TABLE provider_contact_verifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      channel varchar(8) NOT NULL CHECK (channel IN ('EMAIL','PHONE')),
      contact_hash varchar(64) NOT NULL, evidence_reference varchar(100) NOT NULL,
      verified_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      verified_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz)`);
    await q.query(`CREATE INDEX idx_provider_contact_active ON provider_contact_verifications
      (provider_application_id, channel) WHERE revoked_at IS NULL`);
    // Legacy applications remain unverified. Never infer consent or verified contact from a login.
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE provider_contact_verifications');
    await q.query('DROP TABLE provider_consents');
  }
}
