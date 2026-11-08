import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvAccountAdminService } from './ktv-account-admin.service';
import { UpdateKtvAccountDto } from './update-ktv-account.dto';

const providerId = '21e65b23-14f2-471a-9974-50d9dc5e7cbc';
const userId = '5eb35fd3-3d44-4ae6-9a7a-4dfe35ab2437';
const actor = {
  id: '91bfb28f-2f2b-448a-84fb-2d9285ea8280',
  roles: ['SUPER_ADMIN'],
  permissions: ['staff.manage'],
} as AuthUserContext;
const account = {
  providerId,
  userId,
  displayName: 'Thanh Thanh',
  email: 'thanh.old@mocmaria.com',
  phone: null,
  isActive: true,
  mustChangePassword: true,
  isTherapist: true,
  isSuperAdmin: false,
};
type QueryMock = jest.Mock<Promise<unknown[]>, [sql: string, params?: unknown[]]>;
type TransactionMock = jest.Mock<
  Promise<unknown>,
  [callback: (manager: { query: QueryMock }) => Promise<unknown>]
>;

function createDb(options: { collision?: boolean; account?: typeof account } = {}): {
  db: DataSource;
  query: QueryMock;
  transaction: TransactionMock;
} {
  const query: QueryMock = jest.fn((sql: string, _params?: unknown[]) => {
    if (sql.startsWith('SELECT p.id AS')) return Promise.resolve([options.account ?? account]);
    if (sql.startsWith('SELECT id FROM users'))
      return Promise.resolve(options.collision ? [{ id: 'another' }] : []);
    return Promise.resolve([]);
  });
  const transaction: TransactionMock = jest.fn(
    (callback: (manager: { query: QueryMock }) => Promise<unknown>) => callback({ query }),
  );
  const db = { transaction, query } as unknown as DataSource;
  return { db, query, transaction };
}

describe('KTV account editing by Super Admin', () => {
  it('enforces Super Admin even if a normal admin has staff.manage', async () => {
    const { db, transaction, query } = createDb();
    const service = new KtvAccountAdminService(db);
    const admin: AuthUserContext = { ...actor, roles: ['ADMIN'] };
    await expect(service.get(admin, providerId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update(admin, providerId, { email: 'new@mocmaria.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('never exposes the password hash or permits editing Super Admin identities', async () => {
    const { db } = createDb();
    const service = new KtvAccountAdminService(db);
    expect(await service.get(actor, providerId)).toEqual({
      providerId,
      userId,
      displayName: account.displayName,
      email: account.email,
      phone: null,
      isActive: true,
      mustChangePassword: true,
    });
    const restrictedDb = createDb({ account: { ...account, isSuperAdmin: true } });
    await expect(
      new KtvAccountAdminService(restrictedDb.db).update(actor, providerId, {
        email: 'new@mocmaria.com',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('validates email, phone and password input', async () => {
    const invalidEmail = plainToInstance(UpdateKtvAccountDto, { email: 'not-an-email' });
    expect(await validate(invalidEmail)).not.toHaveLength(0);
    const { db, transaction } = createDb();
    await expect(
      new KtvAccountAdminService(db).update(actor, providerId, {
        password: 'short',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('changes login and password atomically, revokes sessions and audits without secrets', async () => {
    const { db, query } = createDb();
    const service = new KtvAccountAdminService(db);
    const next = await service.update(actor, providerId, {
      email: 'Thanh.Thanh@MocMaria.com',
      displayName: 'Thanh Thanh mới',
      password: 'Thanh.New.Password123!',
      mustChangePassword: false,
    });
    expect(next).toMatchObject({
      email: 'thanh.thanh@mocmaria.com',
      displayName: 'Thanh Thanh mới',
      mustChangePassword: false,
    });
    const statements = query.mock.calls;
    const userUpdate = statements.find(([sql]) => sql.startsWith('UPDATE users SET'));
    expect(userUpdate).toBeDefined();
    expect(await argon2.verify(String(userUpdate![1]?.[4]), 'Thanh.New.Password123!')).toBe(true);
    expect(
      statements.some(([sql]) => sql.startsWith('UPDATE refresh_sessions SET revoked_at')),
    ).toBe(true);
    const audit = statements.find(([sql]) => sql.startsWith('INSERT INTO audit_logs'));
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit![1])).not.toContain('Thanh.New.Password123!');
    expect(JSON.stringify(audit![1])).not.toContain('thanh.thanh@mocmaria.com');
    expect(JSON.parse(String(audit![1]?.[3]))).toMatchObject({
      fields: ['email', 'displayName', 'password'],
    });
  });

  it('rejects a duplicate email before any account update', async () => {
    const { db, query } = createDb({ collision: true });
    await expect(
      new KtvAccountAdminService(db).update(actor, providerId, { email: 'used@mocmaria.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE users SET'))).toBe(false);
  });

  it('keeps sessions when only the internal display name changes', async () => {
    const { db, query } = createDb();
    await new KtvAccountAdminService(db).update(actor, providerId, {
      displayName: 'Thanh Thanh A',
    });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE refresh_sessions SET'))).toBe(
      false,
    );
  });
});
