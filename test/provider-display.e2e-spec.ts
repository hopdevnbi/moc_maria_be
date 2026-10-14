import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import {
  ProviderDisplayService,
  PROVIDER_DISPLAY_KEY,
} from '../src/modules/provider-display/provider-display.service';
import type { AuthUserContext } from '../src/modules/identity/identity.types';
import { requireIsolatedDatabase } from './isolated-database';

describe('KTV public display control in isolated PostgreSQL', () => {
  let db: DataSource, service: ProviderDisplayService, actor: AuthUserContext;
  let a: string, b: string, thread: string;
  const users: string[] = [];
  beforeAll(async () => {
    requireIsolatedDatabase();
    db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
    service = new ProviderDisplayService(db);
    for (const name of ['Display admin', 'KTV Ánh', 'KTV Bình']) {
      const [user] = await db.query<{ id: string }[]>(
        `INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,'test-only') RETURNING id`,
        [randomUUID() + '@display.test', name],
      );
      users.push(user.id);
    }
    actor = { id: users[0], roles: ['ADMIN'], permissions: ['staff.manage'] } as AuthUserContext;
    const ids: string[] = [];
    for (const id of users.slice(1)) {
      await db.query(
        "INSERT INTO staff_profiles(user_id,public_name,is_active) VALUES($1,'QA KTV',true)",
        [id],
      );
      const [app] = await db.query<{ id: string }[]>(
        `INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,$2,'APPROVED') RETURNING id`,
        [id, id === users[1] ? 'KTV Ánh' : 'KTV Bình'],
      );
      ids.push(app.id);
    }
    [a, b] = ids;
    const [chat] = await db.query<{ id: string }[]>(
      'INSERT INTO ktv_chat_threads(customer_user_id,provider_user_id,provider_application_id) VALUES($1,$2,$3) RETURNING id',
      [users[0], users[1], a],
    );
    thread = chat.id;
  });
  beforeEach(async () => {
    await db.query('DELETE FROM app_metadata WHERE key=$1', [PROVIDER_DISPLAY_KEY]);
  });
  afterAll(async () => {
    await db.query('DELETE FROM app_metadata WHERE key=$1', [PROVIDER_DISPLAY_KEY]);
    await db.query('DELETE FROM audit_logs WHERE actor_user_id=$1', [users[0]]);
    await db.query('DELETE FROM ktv_chat_threads WHERE id=$1', [thread]);
    await db.query('DELETE FROM provider_applications WHERE id=ANY($1::uuid[])', [[a, b]]);
    await db.query('DELETE FROM staff_profiles WHERE user_id=ANY($1::uuid[])', [users]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
    await db.destroy();
  });
  it('persists a complete order and returns the same order after reload and public projection', async () => {
    const snapshot = await service.list(actor);
    const remaining = snapshot.rows.map((r) => r.id).filter((id) => id !== a && id !== b);
    await service.reorder(actor, { expectedVersion: 0, providerIds: [b, a, ...remaining] });
    expect((await service.list(actor)).rows.slice(0, 2).map((r) => r.id)).toEqual([b, a]);
    expect(
      (await service.publicDisplay()).rows
        .filter((r) => r.visible)
        .slice(0, 2)
        .map((r) => r.providerId),
    ).toEqual([b, a]);
  });
  it('serializes concurrent edits and rejects a stale version instead of overwriting another admin', async () => {
    const result = await Promise.allSettled([
      service.update(actor, a, { expectedVersion: 0, publicName: 'Tên Ánh mới' }),
      service.update(actor, b, { expectedVersion: 0, publicName: 'Tên Bình mới' }),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect((await service.list(actor)).version).toBe(1);
  });
  it('hides and archives without deleting history, and restores into hidden state', async () => {
    await service.update(actor, a, { expectedVersion: 0, visibility: 'ARCHIVED' });
    const publicRow = (await service.publicDisplay()).rows.find((r) => r.providerId === a);
    expect(publicRow).toEqual({ providerId: a, visible: false });
    expect(await db.query('SELECT id FROM ktv_chat_threads WHERE id=$1', [thread])).toHaveLength(1);
    expect(await db.query('SELECT id FROM provider_applications WHERE id=$1', [a])).toHaveLength(1);
    await service.update(actor, a, { expectedVersion: 1, visibility: 'HIDDEN' });
    expect((await service.list(actor)).rows.find((r) => r.id === a)?.visibility).toBe('HIDDEN');
    await service.update(actor, a, { expectedVersion: 2, visibility: 'VISIBLE' });
    expect((await service.publicDisplay()).rows.find((r) => r.providerId === a)?.visible).toBe(
      true,
    );
  });
  it('updates Unicode public info with audit while keeping approval and service eligibility unchanged', async () => {
    await service.update(actor, a, {
      expectedVersion: 0,
      publicName: 'Nguyễn Ánh',
      age: 25,
      yearsExperience: 4,
      introduction: 'Chăm sóc tận tâm',
      serviceArea: 'Hà Nội',
    });
    expect((await service.publicDisplay()).rows.find((r) => r.providerId === a)).toMatchObject({
      publicName: 'Nguyễn Ánh',
      age: 25,
      yearsExperience: 4,
      introduction: 'Chăm sóc tận tâm',
    });
    expect(
      (
        await db.query<{ status: string }[]>(
          'SELECT status FROM provider_applications WHERE id=$1',
          [a],
        )
      )[0].status,
    ).toBe('APPROVED');
    expect(
      await db.query(
        `SELECT id FROM audit_logs WHERE actor_user_id=$1 AND event='provider.display.updated'`,
        [actor.id],
      ),
    ).toHaveLength(1);
  });
  it('rejects missing/unknown identities in reordering and filters hidden chat discovery', async () => {
    await expect(
      service.reorder(actor, { expectedVersion: 0, providerIds: [a] }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.update(actor, a, { expectedVersion: 0, visibility: 'HIDDEN' });
    const cards = await service.applyDirectory([
      { id: a, publicName: 'A', serviceArea: null, title: 'KTV' },
      { id: b, publicName: 'B', serviceArea: null, title: 'KTV' },
    ]);
    expect(cards.map((r) => r.id)).toEqual([b]);
    expect((await service.list(actor)).version).toBe(1);
  });
});
