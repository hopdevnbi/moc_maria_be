import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivateKtvChat1791659000000 implements MigrationInterface {
  name = 'PrivateKtvChat1791659000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ktv_chat_threads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      provider_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE RESTRICT,
      customer_read_seq bigint NOT NULL DEFAULT 0, provider_read_seq bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(customer_user_id, provider_application_id), CHECK(customer_user_id <> provider_user_id))`);
    await q.query(
      `CREATE INDEX ix_ktv_chat_provider ON ktv_chat_threads(provider_user_id,updated_at DESC)`,
    );
    await q.query(`CREATE TABLE ktv_chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seq bigserial UNIQUE NOT NULL,
      thread_id uuid NOT NULL REFERENCES ktv_chat_threads(id) ON DELETE RESTRICT,
      sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      client_message_id uuid NOT NULL, body varchar(2000) NOT NULL CHECK(length(trim(body)) > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(thread_id,sender_user_id,client_message_id))`);
    await q.query(
      `CREATE INDEX ix_ktv_chat_message_history ON ktv_chat_messages(thread_id,seq DESC)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ktv_chat_messages');
    await q.query('DROP TABLE ktv_chat_threads');
  }
}
