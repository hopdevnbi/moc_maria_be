import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { CatalogTranslationsService } from '../src/modules/catalog-translations/catalog-translations.service';
import type { AuthUserContext } from '../src/modules/identity/identity.types';

async function main(): Promise<void> {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw Error('Disposable loopback *_test database required');
  const db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
  try {
    const [existing] = await db.query<{ present: boolean }[]>(
      'SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=$1) AS present',
      ['public'],
    );
    if (existing?.present) throw Error('Empty database required');
    for (const role of ['anon', 'authenticated']) {
      const [row] = await db.query<{ rolname: string }[]>(
        'SELECT rolname FROM pg_roles WHERE rolname=$1',
        [role],
      );
      if (!row) await db.query('CREATE ROLE "' + role + '" NOLOGIN');
    }
    const migrations = await db.runMigrations({ transaction: 'all' });
    console.log('Applied ' + migrations.length + ' migrations');
    const id = randomUUID(),
      category = randomUUID(),
      variant = randomUUID(),
      user = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,'Isolated QA','not-a-login-password',true,false)",
      [user, 'i18n@example.invalid'],
    );
    await db.query(
      "INSERT INTO service_categories(id,name,slug,is_published) VALUES($1,'Original category','i18n-qa-cat',true)",
      [category],
    );
    await db.query(
      "INSERT INTO services(id,category_id,name,slug,description,is_published) VALUES($1,$2,'Original name','i18n-qa-service','Original description',true)",
      [id, category],
    );
    await db.query(
      "INSERT INTO service_variants(id,service_id,name,duration_minutes,price_vnd,is_active) VALUES($1,$2,'Original variant',60,100000,true)",
      [variant, id],
    );
    const actor = { id: user, roles: ['SUPER_ADMIN'] } as AuthUserContext;
    const service = new CatalogTranslationsService(db);
    const read = await service.adminDetail(actor, 'service', id, 'en');
    const dto = {
      name: 'English name',
      description: 'English description',
      status: 'DRAFT' as const,
      expectedVersion: read.version,
      sourceFingerprint: read.sourceFingerprint,
    };
    assert.equal((await service.publicDetail('service', id, 'en')).locale, 'vi');
    const draft = await service.save(actor, 'service', id, 'en', dto);
    assert.equal(draft.version, 1);
    assert.equal((await service.publicDetail('service', id, 'en')).locale, 'vi');
    const publish = { ...dto, status: 'PUBLISHED' as const, expectedVersion: 1 };
    const results = await Promise.allSettled([
      service.save(actor, 'service', id, 'en', publish),
      service.save(actor, 'service', id, 'en', publish),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await service.publicDetail('service', id, 'en')).name, 'English name');
    await db.query("UPDATE services SET name='Changed source' WHERE id=$1", [id]);
    assert.equal((await service.publicDetail('service', id, 'en')).name, 'Changed source');
    assert.equal((await service.adminDetail(actor, 'service', id, 'en')).translation?.stale, true);
    await db.query('UPDATE service_categories SET is_published=false WHERE id=$1', [category]);
    await assert.rejects(service.publicDetail('service', id, 'en'));
    await assert.rejects(service.publicDetail('variant', variant, 'en'));
    const [security] = await db.query<{ rls: boolean; anon: boolean; authenticated: boolean }[]>(
      "SELECT relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT') AS anon,has_table_privilege('authenticated',oid,'INSERT') AS authenticated FROM pg_class WHERE relname='moc_service_translations'",
    );
    assert.deepEqual(security, { rls: true, anon: false, authenticated: false });
    const [audit] = await db.query<{ count: string }[]>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE event='catalog.translation.save' AND actor_user_id=$1",
      [user],
    );
    assert.equal(audit.count, '2');
    console.log(
      'Catalog i18n PostgreSQL integration PASS: draft/publish, concurrent update, stale fallback, hidden parents, RLS, audit.',
    );
  } finally {
    await db.destroy();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Integration failed');
  process.exitCode = 1;
});
