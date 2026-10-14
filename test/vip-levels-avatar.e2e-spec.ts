import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { ProfilesService } from '../src/modules/profiles/profiles.service';
import { ProfilesController } from '../src/modules/profiles/profiles.controller';
import { User } from '../src/modules/identity/entities/user.entity';
import { StaffProfile } from '../src/modules/identity/entities/staff-profile.entity';
import { CustomerManagementService } from '../src/modules/customer-management/customer-management.service';
import type { AuthUserContext } from '../src/modules/identity/identity.types';
import { requireIsolatedDatabase } from './isolated-database';

describe('VIP level and avatar permission with actual isolated SQL', () => {
  let db: DataSource,
    profiles: ProfilesService,
    customers: CustomerManagementService,
    actor: AuthUserContext;
  let id: string;
  const key = (): string => 'mocmaria.customer.vip.' + id;
  const oldEnv = {
    zone: process.env['BUNNY_STORAGE_ZONE'],
    secret: process.env['BUNNY_STORAGE_ACCESS_KEY'],
    cdn: process.env['BUNNY_CDN_BASE_URL'],
  };
  beforeAll(async () => {
    requireIsolatedDatabase();
    db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
    profiles = new ProfilesService(db, db.getRepository(User), db.getRepository(StaffProfile));
    customers = new CustomerManagementService(db);
    const [user] = await db.query<{ id: string }[]>(
      `INSERT INTO users(email,display_name,password_hash) VALUES($1,'VIP QA customer','test-only') RETURNING id`,
      [randomUUID() + '@vip.test'],
    );
    id = user.id;
    await db.query('INSERT INTO customers(user_id) VALUES($1)', [id]);
    actor = { id, roles: ['ADMIN'], permissions: ['customers.manage'] } as AuthUserContext;
    process.env['BUNNY_STORAGE_ZONE'] = 'qa-only';
    process.env['BUNNY_STORAGE_ACCESS_KEY'] = 'test-only';
    process.env['BUNNY_CDN_BASE_URL'] = 'https://cdn.example.test';
  });
  beforeEach(async () => {
    await db.query('DELETE FROM app_metadata WHERE key=$1', [key()]);
    await db.query('UPDATE customers SET avatar_url=NULL WHERE user_id=$1', [id]);
  });
  afterAll(async () => {
    await db.query('DELETE FROM app_metadata WHERE key=$1', [key()]);
    await db.query('DELETE FROM audit_logs WHERE actor_user_id=$1 OR target_user_id=$1', [id]);
    await db.query('DELETE FROM customers WHERE user_id=$1', [id]);
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    await db.destroy();
    for (const [env, value] of [
      ['BUNNY_STORAGE_ZONE', oldEnv.zone],
      ['BUNNY_STORAGE_ACCESS_KEY', oldEnv.secret],
      ['BUNNY_CDN_BASE_URL', oldEnv.cdn],
    ]) {
      if (value === undefined) delete process.env[env!];
      else process.env[env!] = value;
    }
  });
  it('maps an existing active VIP without a level to VIP1 and enables avatar controls', async () => {
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      key(),
      JSON.stringify({ isVip: true, expiresAt: null }),
    ]);
    const view = (await profiles.getCustomer(id)) as {
      membership: { tier: string; level: number };
      avatarUploadEnabled: boolean;
    };
    expect(view.membership).toMatchObject({ tier: 'VIP', level: 1 });
    expect(view.avatarUploadEnabled).toBe(true);
  });
  it('persists an admin-assigned VIP3 in both admin and self views and permits updating an avatar', async () => {
    await customers.updateVip(actor, id, {
      isVip: true,
      level: 3,
      reason: 'Quản trị cấp hạng VIP3 cho hồ sơ kiểm tra',
    });
    expect((await customers.detail(actor, id)).vipLevel).toBe(3);
    const updated = (await profiles.updateCustomerAvatar(
      id,
      'https://cdn.example.test/moc-maria/customer-avatars/qa.webp',
    )) as { membership: { level: number }; customer: { avatarUrl: string } };
    expect(updated.membership.level).toBe(3);
    expect(updated.customer.avatarUrl).toContain('/customer-avatars/');
  });
  it('rejects standard and expired memberships before CDN upload and again before persistence', async () => {
    const upload = jest.fn();
    const controller = new ProfilesController(profiles, { upload });
    await expect(controller.uploadCustomerAvatar(actor, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(upload).not.toHaveBeenCalled();
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      key(),
      JSON.stringify({ isVip: true, level: 5, expiresAt: '2020-01-01T00:00:00Z' }),
    ]);
    await expect(
      profiles.updateCustomerAvatar(id, 'https://cdn.example.test/qa.webp'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const view = (await profiles.getCustomer(id)) as {
      membership: { level: number | null };
      avatarUploadEnabled: boolean;
    };
    expect(view.membership.level).toBeNull();
    expect(view.avatarUploadEnabled).toBe(false);
  });
  it('revokes avatar permission immediately when VIP is removed, and records the prior level', async () => {
    await customers.updateVip(actor, id, {
      isVip: true,
      level: 4,
      reason: 'Quản trị cấp hạng VIP4 kiểm tra quyền',
    });
    await customers.updateVip(actor, id, {
      isVip: false,
      reason: 'Quản trị thu hồi hạng VIP kiểm tra quyền',
    });
    await expect(profiles.assertCustomerAvatarAccess(id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const [stored] = await db.query<{ value: { level: number | null } }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [key()],
    );
    expect(stored.value.level).toBeNull();
    const audit = await db.query<{ metadata: { previousLevel: number; level: number | null } }[]>(
      `SELECT metadata FROM audit_logs WHERE target_user_id=$1 AND event='customer.vip.updated' ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    expect(audit[0].metadata).toMatchObject({ previousLevel: 4, level: null });
  });
});
