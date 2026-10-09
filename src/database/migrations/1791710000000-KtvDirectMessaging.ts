import type { MigrationInterface, QueryRunner } from 'typeorm';

export class KtvDirectMessaging1791710000000 implements MigrationInterface {
  name = 'KtvDirectMessaging1791710000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "ktv_chat_threads" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE CASCADE,
      provider_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_ktv_chat_customer_provider UNIQUE(customer_user_id,provider_application_id),
      CONSTRAINT chk_ktv_chat_distinct CHECK(customer_user_id<>provider_user_id)
    )`);
    await q.query(
      'CREATE INDEX idx_ktv_chat_provider_user ON ktv_chat_threads(provider_user_id,updated_at DESC)',
    );
    await q.query(`CREATE TABLE "ktv_chat_messages" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid NOT NULL REFERENCES ktv_chat_threads(id) ON DELETE CASCADE,
      sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body varchar(2000) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chk_ktv_chat_message_text CHECK(char_length(btrim(body))>=1)
    )`);
    await q.query(
      'CREATE INDEX idx_ktv_chat_messages_thread ON ktv_chat_messages(thread_id,created_at DESC,id DESC)',
    );
    await q.query(
      'CREATE INDEX idx_ktv_chat_sender_recent ON ktv_chat_messages(sender_user_id,created_at DESC)',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "ktv_chat_messages"');
    await q.query('DROP TABLE IF EXISTS "ktv_chat_threads"');
  }
}
