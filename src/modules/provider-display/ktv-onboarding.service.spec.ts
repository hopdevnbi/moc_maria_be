import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { CreateKtvDto } from './create-ktv.dto';
import { KtvOnboardingService } from './ktv-onboarding.service';

const superAdmin = {
  id: '7bf49ab7-9a6b-493d-b281-41b2ff17c621',
  roles: ['SUPER_ADMIN'],
  permissions: ['staff.manage'],
} as AuthUserContext;

const draft = {
  publicName: 'Thanh Thanh',
  serviceArea: 'Hà Nội',
  title: 'KTV giải cơ sâu',
  introduction: 'Lực tay khỏe',
  serviceIds: ['demo-pressure', 'demo-neck'],
} satisfies CreateKtvDto;

describe('Admin creates a new KTV account without fake qualifications', () => {
  it('rejects staff who are not Super Admin before any database access', async () => {
    const transaction = jest.fn();
    const db = { transaction } as unknown as DataSource;
    await expect(
      new KtvOnboardingService(db).create({ ...superAdmin, roles: ['ADMIN'] }, draft),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('validates the selected menu against known KTV care services', async () => {
    expect(
      await validate(plainToInstance(CreateKtvDto, { ...draft, serviceIds: ['unknown'] })),
    ).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateKtvDto, draft))).toHaveLength(0);
  });

  it('creates a distinct identity, APPLIED application and preserves existing KTVs', async () => {
    const registry = { accounts: [{ seedId: 'demo-ktv-06', userId: 'existing' }] };
    const catalog = { profiles: [{ id: 'demo-ktv-06', publicName: 'Nguyễn Hoàn' }] };
    const manager = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT value')) {
          return [{ value: params?.[0] === 'mocmaria.ktv.accounts.v1' ? registry : catalog }];
        }
        if (sql.startsWith('SELECT id FROM roles')) return [{ id: 'role-therapist' }];
        if (sql.startsWith('UPDATE app_metadata')) {
          const destination = params?.[0] === 'mocmaria.ktv.accounts.v1' ? registry : catalog;
          Object.assign(destination, JSON.parse(String(params?.[1])));
        }
        return [];
      }),
    };
    const db = {
      transaction: jest.fn(async (callback: (m: typeof manager) => Promise<unknown>) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const result = await new KtvOnboardingService(db).create(superAdmin, draft);
    expect(result.username).toMatch(/^thanh\.thanh\.[0-9a-f]{8}@mocmaria\.com$/);
    expect(result.temporaryPassword.length).toBeGreaterThan(25);
    expect(result.mustChangePassword).toBe(true);
    expect(result.alias).toBe('ktv-thanh-thanh');
    expect(registry.accounts).toHaveLength(2);
    expect(registry.accounts[0]).toMatchObject({ seedId: 'demo-ktv-06' });
    expect(catalog.profiles).toHaveLength(2);
    expect(catalog.profiles[1]).toMatchObject({
      id: 'ktv-thanh-thanh',
      bookable: false,
      scheduleOpen: false,
    });
    const statements = manager.query.mock.calls.map((call) => call[0]);
    expect(statements.some((sql) => sql.includes("'APPLIED'"))).toBe(true);
    expect(statements.some((sql) => sql.includes('INSERT INTO user_roles'))).toBe(true);
    expect(statements.some((sql) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
    expect(statements.some((sql) => sql.includes('provider_certificates'))).toBe(false);
    expect(statements.some((sql) => sql.includes('provider_weekly_shifts'))).toBe(false);
  });
});
