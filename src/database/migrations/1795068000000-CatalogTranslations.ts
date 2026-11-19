import type { MigrationInterface, QueryRunner } from 'typeorm';

const tables = [
  ['moc_category_translations', 'service_categories'],
  ['moc_service_translations', 'services'],
  ['moc_variant_translations', 'service_variants'],
] as const;

export class CatalogTranslations1795068000000 implements MigrationInterface {
  name = 'CatalogTranslations1795068000000';

  async up(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout = '5s'");
    for (const [table, parent] of tables) {
      await r.query(`CREATE TABLE public.${table} (
        entity_id uuid NOT NULL REFERENCES public.${parent}(id) ON DELETE CASCADE,
        locale varchar(5) NOT NULL CHECK(locale IN ('en','ko','ja','zh-CN','ru')),
        name varchar(160) NOT NULL CHECK(length(btrim(name)) > 0),
        description text CHECK(description IS NULL OR length(description) <= 12000),
        source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot) = 'object'),
        status varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED')),
        version integer NOT NULL DEFAULT 1 CHECK(version > 0),
        updated_by uuid NOT NULL REFERENCES public.users(id),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        published_by uuid REFERENCES public.users(id),
        published_at timestamptz,
        PRIMARY KEY(entity_id,locale),
        CHECK((status='DRAFT' AND published_at IS NULL AND published_by IS NULL) OR
          (status='PUBLISHED' AND published_at IS NOT NULL AND published_by IS NOT NULL)),
        ${parent === 'service_variants' ? 'CHECK(description IS NULL),' : ''}
        CHECK(locale <> 'vi')
      )`);
      await r.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      await r.query(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
      await r.query(`CREATE TRIGGER moc_i18n_public_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
        ON public.${table} FOR EACH STATEMENT EXECUTE FUNCTION moc_cache.touch_public_revision()`);
    }
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout = '5s'");
    await r.query(
      `LOCK TABLE ${tables.map(([table]) => 'public.' + table).join(', ')} IN ACCESS EXCLUSIVE MODE`,
    );
    for (const [table] of tables) {
      const [row] = (await r.query(`SELECT EXISTS(SELECT 1 FROM public.${table}) AS present`)) as {
        present: boolean;
      }[];
      if (!row || row.present)
        throw new Error('Preserve saved catalog translations; export and review before rollback.');
    }
    for (const [table] of [...tables].reverse()) await r.query(`DROP TABLE public.${table}`);
  }
}
