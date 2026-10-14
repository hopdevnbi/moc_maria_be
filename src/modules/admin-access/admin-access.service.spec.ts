import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { DataSource, EntityManager } from 'typeorm';
import { AdminAccessService } from './admin-access.service';
import type { AuthUserContext } from '../identity/identity.types';

const actor: AuthUserContext = {
  id: 'a19a245e-aaf6-4ffb-966d-28338a35b024',
  email: 'admin@example.invalid',
  phone: null,
  displayName: 'Super',
  isActive: true,
  mustChangePassword: false,
  sessionId: 'session',
  roles: ['SUPER_ADMIN'],
  permissions: ['roles.manage'],
};
const targetId = 'c0449038-c39f-4a68-88ae-cfc78c3790d6';

describe('AdminAccessService protections', () => {
  it('rejects ordinary staff and admins even if they have roles.manage', async () => {
    const query = jest.fn();
    const service = new AdminAccessService({ query } as unknown as DataSource);
    await expect(service.roles({ ...actor, roles: ['ADMIN'] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.users({ ...actor, roles: ['RECEPTIONIST'] }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.create(
        { ...actor, permissions: [] },
        {
          displayName: 'Staff',
          email: 'new@example.test',
          role: 'THERAPIST',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('prevents self-demotion and self-suspension before any transaction', async () => {
    const transaction = jest.fn();
    const service = new AdminAccessService({ transaction } as unknown as DataSource);
    await expect(
      service.changeRole(actor, actor.id, {
        role: 'ADMIN',
        reason: 'Không còn được phân công trực tiếp',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setStatus(actor, actor.id, false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects elevation to SUPER_ADMIN without current password and explicit confirmation', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: targetId, has_customer: false }])
      .mockResolvedValueOnce([{ name: 'ADMIN' }]);
    const manager = { query } as unknown as EntityManager;
    const transaction = jest.fn((callback: (manager: EntityManager) => Promise<unknown>) =>
      callback(manager),
    );
    const service = new AdminAccessService({ transaction } as unknown as DataSource);
    await expect(
      service.changeRole(actor, targetId, {
        role: 'SUPER_ADMIN',
        reason: 'Người phụ trách vận hành hệ thống',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM user_roles'))).toBe(
      false,
    );
  });

  it('refuses to disable the final active SUPER_ADMIN', async () => {
    const hash = await argon2.hash('ValidPass123!', { memoryCost: 4096, timeCost: 1 });
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: targetId, is_active: true }])
      .mockResolvedValueOnce([{ is_super: true }])
      .mockResolvedValueOnce([{ password_hash: hash }])
      .mockResolvedValueOnce([{ total: 1 }]);
    const transaction = jest.fn((callback: (manager: EntityManager) => Promise<unknown>) =>
      callback({ query } as unknown as EntityManager),
    );
    const service = new AdminAccessService({ transaction } as unknown as DataSource);
    await expect(
      service.setStatus(actor, targetId, false, {
        confirmation: 'CONFIRM_SUPER_ADMIN',
        currentPassword: 'ValidPass123!',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users'))).toBe(false);
  });

  it('retains CUSTOMER access when a customer also becomes KTV and revokes sessions', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: targetId, has_customer: true }])
      .mockResolvedValueOnce([{ name: 'CUSTOMER' }])
      .mockResolvedValueOnce([
        { id: 'role-a', name: 'THERAPIST' },
        { id: 'role-b', name: 'CUSTOMER' },
      ])
      .mockResolvedValue([]);
    const manager = { query } as unknown as EntityManager;
    const transaction = jest.fn((callback: (manager: EntityManager) => Promise<unknown>) =>
      callback(manager),
    );
    const dbQuery = jest
      .fn()
      .mockResolvedValue([{ id: targetId, roles: ['CUSTOMER', 'THERAPIST'] }]);
    const service = new AdminAccessService({
      transaction,
      query: dbQuery,
    } as unknown as DataSource);
    await service.changeRole(actor, targetId, {
      role: 'THERAPIST',
      reason: 'Đã nhận nhiệm vụ nhân sự mới',
    });
    const calls = query.mock.calls as Array<[string, unknown[]]>;
    expect(
      calls.some(
        ([sql, args]) =>
          String(sql).includes('name=ANY') && JSON.stringify(args).includes('CUSTOMER'),
      ),
    ).toBe(true);
    expect(calls.some(([sql]) => String(sql).includes('UPDATE refresh_sessions'))).toBe(true);
    expect(calls.some(([sql]) => String(sql).includes('ACCESS_ROLE_CHANGED'))).toBe(true);
  });
});
