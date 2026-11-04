import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { PublicContentCache1793775435753 } from '../src/database/migrations/1793775435753-PublicContentCache';
import { PublicCacheModule } from '../src/shared/public-cache/public-cache.module';
import { PublicRevisionService } from '../src/shared/public-cache/public-revision.service';
import { requireIsolatedDatabase } from './isolated-database';

const prefix = 'mocmaria.catalog.cache-qa.' + randomUUID();
const key = prefix + '.content';
@Controller()
class PublicFixtureController {
  constructor(private readonly db: DataSource) {}
  @Get('services')
  async services(): Promise<unknown> {
    const [row] = await this.db.query<Array<{ value: unknown }>>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [key],
    );
    return row?.value ?? {};
  }
}
@Module({
  imports: [TypeOrmModule.forRoot(buildDatabaseOptionsFromEnv(process.env)), PublicCacheModule],
  controllers: [PublicFixtureController],
})
class PublicFixtureModule {}

describe('public cache on isolated PostgreSQL', () => {
  let db: DataSource;
  let revisions: PublicRevisionService;
  let a: Awaited<ReturnType<typeof NestFactory.create>>;
  let b: Awaited<ReturnType<typeof NestFactory.create>>;
  const users: string[] = [];
  beforeAll(async () => {
    requireIsolatedDatabase();
    process.env['PUBLIC_CONTENT_CACHE_ENABLED'] = 'true';
    db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
    revisions = new PublicRevisionService(db);
    a = await NestFactory.create(PublicFixtureModule, { logger: false });
    b = await NestFactory.create(PublicFixtureModule, { logger: false });
    await a.init();
    await b.init();
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      key,
      JSON.stringify({ label: 'before' }),
    ]);
  }, 30000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    if (db?.isInitialized) {
      await db.query('DELETE FROM app_metadata WHERE key LIKE $1', [prefix + '%']);
      await db.query('DELETE FROM provider_applications WHERE user_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
      await db.destroy();
    }
    delete process.env['PUBLIC_CONTENT_CACHE_ENABLED'];
  });

  it('serves RAM hits then immediately misses on both API instances after raw SQL CRUD', async () => {
    await request(a.getHttpServer() as Server)
      .get('/services')
      .expect(200)
      .expect('X-Public-Cache', 'MISS');
    await request(b.getHttpServer() as Server)
      .get('/services')
      .expect(200)
      .expect('X-Public-Cache', 'MISS');
    await request(a.getHttpServer() as Server)
      .get('/services')
      .expect(200)
      .expect('X-Public-Cache', 'HIT');
    const before = await revisions.read();
    await db.query('UPDATE app_metadata SET value=$2::jsonb WHERE key=$1', [
      key,
      JSON.stringify({ label: 'after' }),
    ]);
    const after = await revisions.read();
    expect(after.revision).not.toBe(before.revision);
    for (const app of [a, b]) {
      const response = await request(app.getHttpServer() as Server)
        .get('/services')
        .expect(200)
        .expect('X-Public-Cache', 'MISS');
      expect(response.body).toEqual({ label: 'after' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('rolls back content and its revision together', async () => {
    const before = await revisions.read();
    const tx = db.createQueryRunner();
    await tx.connect();
    await tx.startTransaction();
    try {
      await tx.query('UPDATE app_metadata SET value=$2::jsonb WHERE key=$1', [
        key,
        JSON.stringify({ label: 'not committed' }),
      ]);
      await tx.rollbackTransaction();
    } finally {
      await tx.release();
    }
    expect((await revisions.read()).revision).toBe(before.revision);
  });

  it('invalidates real catalog inserts, hiding and deletion without changing booking tables', async () => {
    const suffix = randomUUID();
    const [category] = await db.query<Array<{ id: string }>>(
      'INSERT INTO service_categories(name,slug,is_published) VALUES($1,$2,true) RETURNING id',
      ['Cache isolated category', 'cache-' + suffix],
    );
    let serviceId: string | undefined;
    try {
      let before = await revisions.read();
      const [service] = await db.query<Array<{ id: string }>>(
        'INSERT INTO services(category_id,name,slug,is_published) VALUES($1,$2,$3,true) RETURNING id',
        [category.id, 'Cache isolated service', 'cache-' + suffix],
      );
      serviceId = service.id;
      expect((await revisions.read()).revision).not.toBe(before.revision);
      before = await revisions.read();
      await db.query('UPDATE services SET is_published=false WHERE id=$1', [serviceId]);
      expect((await revisions.read()).revision).not.toBe(before.revision);
      before = await revisions.read();
      await db.query('DELETE FROM services WHERE id=$1', [serviceId]);
      expect((await revisions.read()).revision).not.toBe(before.revision);
    } finally {
      if (serviceId) await db.query('DELETE FROM services WHERE id=$1', [serviceId]);
      await db.query('DELETE FROM service_categories WHERE id=$1', [category.id]);
    }
  });

  it('counts a late commit without serializing independent writes on a global counter', async () => {
    const before = await revisions.read();
    const first = db.createQueryRunner();
    const second = db.createQueryRunner();
    await first.connect();
    await second.connect();
    await first.startTransaction();
    await second.startTransaction();
    try {
      await first.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
        prefix + '.first',
        '{"title":"first"}',
      ]);
      await second.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
        prefix + '.second',
        '{"title":"second"}',
      ]);
      await second.commitTransaction();
      const middle = await revisions.read();
      expect(BigInt(middle.sequence)).toBe(BigInt(before.sequence) + 1n);
      await first.commitTransaction();
      const after = await revisions.read();
      expect(BigInt(after.sequence)).toBe(BigInt(before.sequence) + 2n);
      expect(after.revision).not.toBe(middle.revision);
    } finally {
      if (first.isTransactionActive) await first.rollbackTransaction();
      if (second.isTransactionActive) await second.rollbackTransaction();
      await first.release();
      await second.release();
    }
  });

  it('deduplicates multiple public writes in one transaction and ignores private metadata', async () => {
    const before = await revisions.read();
    await db.transaction(async (m) => {
      await m.query('UPDATE app_metadata SET value=$2::jsonb WHERE key=$1', [
        key,
        '{"label":"one"}',
      ]);
      await m.query('UPDATE app_metadata SET value=$2::jsonb WHERE key=$1', [
        key,
        '{"label":"two"}',
      ]);
    });
    expect(BigInt((await revisions.read()).sequence)).toBe(BigInt(before.sequence) + 1n);
    const latest = await revisions.read();
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      'mocmaria.inquiry.cache-private-qa',
      '{}',
    ]);
    await db.query('DELETE FROM app_metadata WHERE key=$1', ['mocmaria.inquiry.cache-private-qa']);
    await db.query(
      'UPDATE app_metadata SET value=value,updated_at=clock_timestamp() WHERE key=$1',
      [key],
    );
    expect((await revisions.read()).revision).toBe(latest.revision);
  });

  it('invalidates provider deactivation but ignores private customer/password-only writes', async () => {
    const before = await revisions.read();
    const [user] = await db.query<Array<{ id: string }>>(
      'INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',
      [randomUUID() + '@cache.test', 'Cache isolated user', 'test-only'],
    );
    users.push(user.id);
    expect((await revisions.read()).revision).toBe(before.revision);
    await db.query(
      'INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,$2,$3)',
      [user.id, 'Cache isolated provider', 'APPROVED'],
    );
    const active = await revisions.read();
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [user.id, 'changed-test-only']);
    expect((await revisions.read()).revision).toBe(active.revision);
    await db.query('UPDATE users SET is_active=false WHERE id=$1', [user.id]);
    expect((await revisions.read()).revision).not.toBe(active.revision);
  });

  it('keeps the revision endpoint compatible and prevents anon access to private cache tables', async () => {
    const response = await request(a.getHttpServer() as Server)
      .get('/public-content/revision')
      .expect(200);
    const body = response.body as { revision: string; sequence: string; enabled: boolean };
    expect(body.revision).toMatch(/^[a-f0-9]{24}$/);
    expect(body.sequence).toMatch(/^\d+$/);
    expect(body.enabled).toBe(true);
    const tx = db.createQueryRunner();
    await tx.connect();
    await tx.startTransaction();
    try {
      await tx.query('SET LOCAL ROLE anon');
      await expect(tx.query('SELECT * FROM moc_cache.public_revision')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await tx.rollbackTransaction();
      await tx.release();
    }
  });

  it('rolls back and reapplies only the cache migration without touching source records', async () => {
    await a.close();
    await b.close();
    const tx = db.createQueryRunner();
    await tx.connect();
    await tx.startTransaction();
    try {
      const migration = new PublicContentCache1793775435753();
      await migration.down(tx);
      const schemas: unknown = await tx.query("SELECT to_regnamespace('moc_cache') AS schema");
      expect((schemas as Array<{ schema: string | null }>)[0].schema).toBeNull();
      await migration.up(tx);
      const rows: unknown = await tx.query('SELECT value FROM app_metadata WHERE key=$1', [key]);
      expect((rows as Array<{ value: { label: string } }>)[0].value.label).toBe('two');
      await tx.commitTransaction();
    } finally {
      if (tx.isTransactionActive) await tx.rollbackTransaction();
      await tx.release();
    }
  }, 30000);
});
