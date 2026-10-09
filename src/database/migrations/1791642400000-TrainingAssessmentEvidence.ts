import { MigrationInterface, QueryRunner } from 'typeorm';
export class TrainingAssessmentEvidence1791642400000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE provider_training_courses ADD COLUMN requirements_revision integer NOT NULL DEFAULT 1 CHECK(requirements_revision>0)',
    );
    await q.query(
      `ALTER TABLE provider_training_modules ADD COLUMN required_minutes integer CHECK(required_minutes BETWEEN 1 AND 4800)`,
    );
    await q.query(`CREATE TABLE provider_training_criteria(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES provider_training_courses(id) ON DELETE RESTRICT,
      service_id uuid REFERENCES services(id) ON DELETE RESTRICT,
      code varchar(80) NOT NULL, title varchar(180) NOT NULL,
      minimum_score smallint NOT NULL CHECK(minimum_score BETWEEN 1 AND 100),
      is_required boolean NOT NULL DEFAULT true,is_active boolean NOT NULL DEFAULT true,
      UNIQUE(course_id,code))`);
    await q.query(`CREATE TABLE provider_training_assessments(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),enrollment_id uuid NOT NULL REFERENCES provider_training_enrollments(id) ON DELETE RESTRICT,
      evidence_fingerprint char(64) NOT NULL,attendance_percent smallint NOT NULL CHECK(attendance_percent BETWEEN 0 AND 100),
      passed boolean NOT NULL,valid_until timestamptz NOT NULL,
      evidence_reference varchar(100) NOT NULL,reason varchar(500) NOT NULL,
      assessed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,assessed_at timestamptz NOT NULL DEFAULT now(),
      snapshot jsonb NOT NULL)`);
    await q.query(
      `CREATE INDEX ix_training_assessment_history ON provider_training_assessments(enrollment_id,assessed_at)`,
    );
    await q.query(
      `ALTER TABLE provider_training_enrollments ADD COLUMN latest_assessment_id uuid REFERENCES provider_training_assessments(id) ON DELETE RESTRICT`,
    );
    await q.query(
      `ALTER TABLE provider_training_certificates ADD COLUMN assessment_id uuid REFERENCES provider_training_assessments(id) ON DELETE RESTRICT`,
    );
    await q.query(`CREATE TABLE provider_certificate_issuances(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),certificate_id uuid NOT NULL REFERENCES provider_training_certificates(id) ON DELETE RESTRICT,
      certificate_number varchar(60) NOT NULL UNIQUE,kind varchar(16) NOT NULL CHECK(kind IN ('IMPORTED','ISSUED','RENEWED')),
      assessment_id uuid REFERENCES provider_training_assessments(id) ON DELETE RESTRICT,
      issued_at timestamptz NOT NULL,expires_at timestamptz,
      issued_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,reason varchar(500) NOT NULL,
      previous_snapshot jsonb)`);
    // Preserve existing recorded issuance facts without asserting new evidence or validity.
    await q.query(`INSERT INTO provider_certificate_issuances(certificate_id,certificate_number,kind,issued_at,expires_at,issued_by,reason)
      SELECT id,certificate_number,'IMPORTED',issued_at,expires_at,issued_by,'Existing issuance record preserved by migration; detailed evidence not verified'
      FROM provider_training_certificates`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE provider_certificate_issuances');
    await q.query('ALTER TABLE provider_training_certificates DROP COLUMN assessment_id');
    await q.query('ALTER TABLE provider_training_enrollments DROP COLUMN latest_assessment_id');
    await q.query('DROP TABLE provider_training_assessments');
    await q.query('DROP TABLE provider_training_criteria');
    await q.query('ALTER TABLE provider_training_modules DROP COLUMN required_minutes');
    await q.query('ALTER TABLE provider_training_courses DROP COLUMN requirements_revision');
  }
}
