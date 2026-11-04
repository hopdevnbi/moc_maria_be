import type { MigrationInterface, QueryRunner } from 'typeorm';

// Deliberately excludes appointments/chat/customer/auth-session tables and private metadata.
const tables = [
  'service_categories',
  'services',
  'service_variants',
  'service_provider_policies',
  'branches',
  'branch_services',
  'branch_resources',
  'branch_business_hours',
  'branch_exception_hours',
  'provider_applications',
  'staff_profiles',
  'user_roles',
  'roles',
  'provider_branch_assignments',
  'provider_public_profiles',
  'provider_consents',
  'provider_contact_verifications',
  'provider_operating_reviews',
  'provider_service_grants',
  'provider_skills',
  'provider_certificate_issuances',
  'provider_training_assessments',
  'provider_training_attendance',
  'provider_training_attendance_events',
  'provider_training_certificates',
  'provider_training_courses',
  'provider_training_criteria',
  'provider_training_enrollments',
  'provider_training_modules',
  'provider_training_session_roster',
  'provider_training_sessions',
  'provider_weekly_shifts',
  'provider_date_schedules',
  'provider_reviews',
  'provider_review_history',
];

export class PublicContentCache1793775435753 implements MigrationInterface {
  name = 'PublicContentCache1793775435753';

  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE SCHEMA moc_cache');
    await q.query(`CREATE TABLE moc_cache.public_revision (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      epoch uuid NOT NULL DEFAULT gen_random_uuid()
    )`);
    // One committed marker per public-writing transaction, without a shared UPDATE lock.
    // COUNT(committed markers), unlike MAX(sequence IDs), also changes for late commits.
    await q.query(`CREATE TABLE moc_cache.public_changes (
      transaction_id text PRIMARY KEY CHECK(transaction_id ~ '^[0-9]{1,24}$'),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query('ALTER TABLE moc_cache.public_revision ENABLE ROW LEVEL SECURITY');
    await q.query('ALTER TABLE moc_cache.public_changes ENABLE ROW LEVEL SECURITY');
    await q.query('REVOKE ALL ON SCHEMA moc_cache FROM PUBLIC');
    await q.query('REVOKE ALL ON moc_cache.public_revision FROM PUBLIC');
    await q.query('REVOKE ALL ON moc_cache.public_changes FROM PUBLIC');
    await q.query('INSERT INTO moc_cache.public_revision(singleton) VALUES(true)');
    await q.query(`CREATE FUNCTION moc_cache.touch_public_revision() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $body$
      BEGIN
        INSERT INTO moc_cache.public_changes(transaction_id) VALUES(pg_current_xact_id()::text)
          ON CONFLICT DO NOTHING;
        RETURN NULL;
      END $body$`);
    await q.query(`CREATE FUNCTION moc_cache.is_public_key(k text) RETURNS boolean
      LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $body$
      SELECT k IN ('mocmaria.provider.display.v1','mocmaria.ktv.accounts.v1',
        'mocmaria.demo.ktv.v1','mocmaria.demo.services.v1')
        OR k LIKE ANY(ARRAY['mocmaria.presentation.%','mocmaria.provider.profile.%',
          'mocmaria.ktv.showcase.v1.%','mocmaria.catalog.%'])
      $body$`);
    await q.query(`CREATE FUNCTION moc_cache.touch_public_metadata() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $body$
      DECLARE relevant boolean := false;
      BEGIN
        IF TG_OP='UPDATE' AND NEW.key=OLD.key AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
          RETURN NULL;
        END IF;
        IF TG_OP<>'INSERT' THEN relevant := moc_cache.is_public_key(OLD.key); END IF;
        IF TG_OP<>'DELETE' THEN relevant := COALESCE(relevant,false) OR moc_cache.is_public_key(NEW.key); END IF;
        IF relevant THEN
          INSERT INTO moc_cache.public_changes(transaction_id) VALUES(pg_current_xact_id()::text)
            ON CONFLICT DO NOTHING;
        END IF;
        RETURN NULL;
      END $body$`);
    await q.query(`CREATE FUNCTION moc_cache.touch_provider_user() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $body$
      BEGIN
        IF TG_OP='UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
          AND NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN RETURN NULL; END IF;
        IF EXISTS(SELECT 1 FROM public.provider_applications WHERE user_id=COALESCE(NEW.id,OLD.id)) THEN
          INSERT INTO moc_cache.public_changes(transaction_id) VALUES(pg_current_xact_id()::text)
            ON CONFLICT DO NOTHING;
        END IF;
        RETURN NULL;
      END $body$`);
    for (const name of tables) {
      if (!(await q.hasTable('public.' + name)))
        throw new Error('Missing public cache source table: ' + name);
      await q.query(`CREATE TRIGGER moc_public_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
        ON public."${name}" FOR EACH STATEMENT EXECUTE FUNCTION moc_cache.touch_public_revision()`);
    }
    await q.query(`CREATE TRIGGER moc_public_metadata_revision AFTER INSERT OR UPDATE OR DELETE
      ON public.app_metadata FOR EACH ROW EXECUTE FUNCTION moc_cache.touch_public_metadata()`);
    await q.query(`CREATE TRIGGER moc_public_metadata_truncate AFTER TRUNCATE
      ON public.app_metadata FOR EACH STATEMENT EXECUTE FUNCTION moc_cache.touch_public_revision()`);
    await q.query(`CREATE TRIGGER moc_public_user_revision AFTER INSERT OR UPDATE OR DELETE
      ON public.users FOR EACH ROW EXECUTE FUNCTION moc_cache.touch_provider_user()`);
    await q.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA moc_cache FROM PUBLIC');
  }

  async down(q: QueryRunner): Promise<void> {
    for (const name of tables) {
      await q.query(`DROP TRIGGER IF EXISTS moc_public_revision ON public."${name}"`);
    }
    await q.query('DROP TRIGGER IF EXISTS moc_public_metadata_revision ON public.app_metadata');
    await q.query('DROP TRIGGER IF EXISTS moc_public_metadata_truncate ON public.app_metadata');
    await q.query('DROP TRIGGER IF EXISTS moc_public_user_revision ON public.users');
    await q.query('DROP SCHEMA moc_cache CASCADE');
  }
}
