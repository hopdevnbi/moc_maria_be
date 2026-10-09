import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrainingSessionsAttendance1791638800000 implements MigrationInterface {
  name = 'TrainingSessionsAttendance1791638800000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE provider_training_modules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id uuid NOT NULL REFERENCES provider_training_courses(id) ON DELETE RESTRICT,
      code varchar(80) NOT NULL, title varchar(180) NOT NULL,
      sort_order smallint NOT NULL CHECK(sort_order BETWEEN 0 AND 32767),
      is_required boolean NOT NULL DEFAULT true, is_active boolean NOT NULL DEFAULT true,
      UNIQUE(course_id,code))`);
    await q.query(`CREATE TABLE provider_training_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      module_id uuid NOT NULL REFERENCES provider_training_modules(id) ON DELETE RESTRICT,
      branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
      instructor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
      CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '8 hours'),
      status varchar(16) NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','COMPLETED','CANCELLED')),
      completion_reference varchar(100), recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      recorded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(status<>'COMPLETED' OR completion_reference IS NOT NULL))`);
    await q.query(
      `CREATE INDEX idx_training_session_instructor_time ON provider_training_sessions(instructor_user_id,starts_at,ends_at)`,
    );
    await q.query(`CREATE TABLE provider_training_session_roster (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL REFERENCES provider_training_sessions(id) ON DELETE RESTRICT,
      enrollment_id uuid NOT NULL REFERENCES provider_training_enrollments(id) ON DELETE RESTRICT,
      is_active boolean NOT NULL DEFAULT true, added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      added_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,enrollment_id))`);
    await q.query(`CREATE TABLE provider_training_attendance (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      roster_id uuid NOT NULL UNIQUE REFERENCES provider_training_session_roster(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL CHECK(status IN ('PRESENT','ABSENT','EXCUSED')),
      attended_minutes smallint NOT NULL CHECK(attended_minutes BETWEEN 0 AND 480),
      CHECK(status='PRESENT' OR attended_minutes=0),
      evidence_reference varchar(100) NOT NULL,
      marked_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      marked_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE provider_training_attendance_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      attendance_id uuid NOT NULL REFERENCES provider_training_attendance(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL CHECK(status IN ('PRESENT','ABSENT','EXCUSED')),
      attended_minutes smallint NOT NULL CHECK(attended_minutes BETWEEN 0 AND 480),
      CHECK(status='PRESENT' OR attended_minutes=0), evidence_reference varchar(100) NOT NULL,
      reason varchar(500) NOT NULL, marked_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      marked_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX idx_training_attendance_events ON provider_training_attendance_events(attendance_id,marked_at)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'provider_training_attendance_events',
      'provider_training_attendance',
      'provider_training_session_roster',
      'provider_training_sessions',
      'provider_training_modules',
    ])
      await q.query(`DROP TABLE ${table}`);
  }
}
