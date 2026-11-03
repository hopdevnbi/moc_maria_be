import type { MigrationInterface, QueryRunner } from 'typeorm';

export class KtvChatWebPush1793700000000 implements MigrationInterface {
  name = 'KtvChatWebPush1793700000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ktv_chat_push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id uuid NOT NULL REFERENCES refresh_sessions(id) ON DELETE CASCADE,
      endpoint_hash varchar(64) NOT NULL UNIQUE,
      endpoint text NOT NULL,
      p256dh text NOT NULL,
      auth_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query('CREATE INDEX ix_ktv_push_user ON ktv_chat_push_subscriptions(user_id)');
    await q.query('CREATE INDEX ix_ktv_push_session ON ktv_chat_push_subscriptions(session_id)');
    // The public schema may be reachable through Supabase Data API; browser
    // subscriptions and encryption keys are exclusively owned by this backend.
    await q.query('ALTER TABLE ktv_chat_push_subscriptions ENABLE ROW LEVEL SECURITY');
    await q.query('REVOKE ALL ON TABLE ktv_chat_push_subscriptions FROM anon, authenticated');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE ktv_chat_push_subscriptions');
  }
}
