import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ProviderShowcaseTranslations1795071600000 implements MigrationInterface {
  name = 'ProviderShowcaseTranslations1795071600000';
  async up(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout = '5s'");
    await r.query(`CREATE TABLE public.moc_provider_showcase_translations (
      provider_id uuid NOT NULL REFERENCES public.provider_applications(id) ON DELETE CASCADE,
      locale varchar(5) NOT NULL CHECK(locale IN ('en','ko','ja','zh-CN','ru')),
      headline varchar(240) NOT NULL DEFAULT '', biography varchar(4000) NOT NULL DEFAULT '', schedule_note varchar(600) NOT NULL DEFAULT '',
      source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
      status varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      updated_by uuid NOT NULL REFERENCES public.users(id), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      published_by uuid REFERENCES public.users(id), published_at timestamptz,
      PRIMARY KEY(provider_id,locale),
      CHECK((status='DRAFT' AND published_at IS NULL AND published_by IS NULL) OR (status='PUBLISHED' AND published_at IS NOT NULL AND published_by IS NOT NULL)),
      CHECK(length(btrim(headline))+length(btrim(biography))+length(btrim(schedule_note))>0)
    )`);
    await r.query(
      'ALTER TABLE public.moc_provider_showcase_translations ENABLE ROW LEVEL SECURITY',
    );
    await r.query(
      'REVOKE ALL ON TABLE public.moc_provider_showcase_translations FROM PUBLIC, anon, authenticated',
    );
    await r.query(
      'CREATE TRIGGER moc_i18n_public_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.moc_provider_showcase_translations FOR EACH STATEMENT EXECUTE FUNCTION moc_cache.touch_public_revision()',
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout = '5s'");
    await r.query('LOCK TABLE public.moc_provider_showcase_translations IN ACCESS EXCLUSIVE MODE');
    const [row] = (await r.query(
      'SELECT EXISTS(SELECT 1 FROM public.moc_provider_showcase_translations) AS present',
    )) as { present: boolean }[];
    if (!row || row.present)
      throw Error('Preserve saved provider translations; export before rollback.');
    await r.query('DROP TABLE public.moc_provider_showcase_translations');
  }
}
