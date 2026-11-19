import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AppMetadataPrivate1795075200000 implements MigrationInterface {
  name = 'AppMetadataPrivate1795075200000';

  async up(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout = '5s'");
    await r.query('ALTER TABLE public.app_metadata ENABLE ROW LEVEL SECURITY');
    await r.query('REVOKE ALL ON TABLE public.app_metadata FROM PUBLIC, anon, authenticated');
    // Fail closed if inherited or column-level grants still allow public access.
    const [security] = (await r.query(`
      SELECT c.relrowsecurity AS rls,
        EXISTS (
          SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS role_name
          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS permission
          WHERE has_table_privilege(role_name,c.oid,permission)
        ) OR EXISTS (
          SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS role_name
          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS permission
          WHERE has_any_column_privilege(role_name,c.oid,permission)
        ) AS "publicAccess"
      FROM pg_class c WHERE c.oid='public.app_metadata'::regclass
    `)) as { rls: boolean; publicAccess: boolean }[];
    if (!security?.rls || security.publicAccess)
      throw new Error('App metadata access is not private');
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Do not reopen direct client access to private application metadata. Roll back application code independently.',
      ),
    );
  }
}
