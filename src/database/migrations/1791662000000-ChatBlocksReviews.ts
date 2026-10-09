import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ChatBlocksReviews1791662000000 implements MigrationInterface {
  name = 'ChatBlocksReviews1791662000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ktv_chat_blocks (
      thread_id uuid NOT NULL REFERENCES ktv_chat_threads(id) ON DELETE RESTRICT,
      blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      expires_at timestamptz, revoked_at timestamptz, reason varchar(200),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(thread_id,blocker_user_id))`);
    await q.query(`CREATE TABLE provider_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE RESTRICT,
      customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      stars smallint NOT NULL CHECK(stars BETWEEN 1 AND 5),
      comment varchar(2000) NOT NULL CHECK(length(trim(comment)) BETWEEN 1 AND 2000),
      visibility varchar(16) NOT NULL DEFAULT 'PUBLISHED' CHECK(visibility IN ('PUBLISHED','HIDDEN')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(appointment_id,provider_application_id),
      FOREIGN KEY(appointment_id,provider_application_id) REFERENCES appointment_staff(appointment_id,provider_application_id) ON DELETE RESTRICT)`);
    await q.query(
      `CREATE INDEX ix_provider_reviews_public ON provider_reviews(provider_application_id,created_at DESC,id DESC) WHERE visibility='PUBLISHED'`,
    );
    await q.query(`CREATE TABLE provider_review_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL REFERENCES provider_reviews(id) ON DELETE RESTRICT,
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action varchar(16) NOT NULL CHECK(action IN ('CREATE','EDIT','MODERATE')),
      stars smallint NOT NULL CHECK(stars BETWEEN 1 AND 5),comment varchar(2000) NOT NULL,
      visibility varchar(16) NOT NULL CHECK(visibility IN ('PUBLISHED','HIDDEN')),reason varchar(500),
      version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE provider_review_history');
    await q.query('DROP TABLE provider_reviews');
    await q.query('DROP TABLE ktv_chat_blocks');
  }
}
