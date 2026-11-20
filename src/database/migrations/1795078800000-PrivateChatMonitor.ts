import type { MigrationInterface, QueryRunner } from 'typeorm';
export class PrivateChatMonitor1795078800000 implements MigrationInterface {
  name = 'PrivateChatMonitor1795078800000';
  async up(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout = '5s'");
    for (const table of [
      'ktv_chat_threads',
      'ktv_chat_messages',
      'ktv_chat_blocks',
      'audit_logs',
      'users',
      'roles',
      'permissions',
      'user_roles',
      'role_permissions',
      'refresh_sessions',
      'password_reset_tokens',
    ]) {
      await r.query('ALTER TABLE public.' + table + ' ENABLE ROW LEVEL SECURITY');
      await r.query('REVOKE ALL ON TABLE public.' + table + ' FROM PUBLIC, anon, authenticated');
      const [s] = (await r.query(
        `SELECT c.relrowsecurity AS rls,
        EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS role_name
        CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS permission
        WHERE has_table_privilege(role_name,c.oid,permission))
        OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS role_name
        CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS permission
        WHERE has_any_column_privilege(role_name,c.oid,permission)) AS "publicAccess"
        FROM pg_class c WHERE c.oid=$1::regclass`,
        ['public.' + table],
      )) as { rls: boolean; publicAccess: boolean }[];
      if (!s?.rls || s.publicAccess) throw Error('Private chat security verification failed');
    }
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Keep private chat and audit tables protected; rollback application code separately.',
      ),
    );
  }
}
