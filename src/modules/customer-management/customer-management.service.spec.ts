import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { CustomerManagementService } from './customer-management.service';

const customerId = '1f47253e-aa9a-49d5-a166-5bc4bdb79ba4';
const admin: AuthUserContext = {
  id: '900d103d-124c-4e9d-9411-a8b21b1b9eb0',
  email: 'admin@example.test',
  phone: null,
  displayName: 'Admin',
  isActive: true,
  mustChangePassword: false,
  sessionId: 'session',
  roles: ['ADMIN'],
  permissions: ['customers.manage'],
};

describe('CustomerManagementService', () => {
  it('refuses customer and non-admin roles before touching private records', async () => {
    const query = jest.fn();
    const db = { query, transaction: jest.fn() } as unknown as DataSource;
    const service = new CustomerManagementService(db);
    await expect(
      service.list({ ...admin, roles: ['CUSTOMER'] }, { page: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.detail({ ...admin, permissions: [] }, customerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.updateVip({ ...admin, roles: ['RECEPTIONIST'] }, customerId, {
        isVip: true,
        reason: 'Quản trị đã duyệt thủ công',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('uses SQL parameters for search and correctly treats absent VIP metadata as standard', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ all: 1, vip: 0, standard: 1, active: 1 }])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([]);
    const service = new CustomerManagementService({ query } as unknown as DataSource);
    const response = await service.list(admin, {
      q: "Tên'); DROP TABLE users; --",
      tier: 'STANDARD',
      status: 'ACTIVE',
      page: 2,
      limit: 5,
    });
    expect(response.counts).toEqual({ all: 1, vip: 0, standard: 1, active: 1 });
    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls[2][1]).toEqual(["Tên'); DROP TABLE users; --", 'STANDARD', 'ACTIVE', 5, 5]);
    expect(calls[2][0]).toContain('COALESCE(');
  });

  it('rejects expired dates before attempting a VIP transaction', async () => {
    const transaction = jest.fn();
    const service = new CustomerManagementService({ transaction } as unknown as DataSource);
    await expect(
      service.updateVip(admin, customerId, {
        isVip: true,
        expiresAt: '2020-01-01T00:00:00Z',
        reason: 'Khách được duyệt lên hạng VIP',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('records manually approved VIP changes and audit reason in the same transaction', async () => {
    const save = jest.fn();
    const managerQuery = jest
      .fn()
      .mockResolvedValueOnce([{ id: customerId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const manager = { query: managerQuery, save } as unknown as EntityManager;
    const transaction = jest.fn((action: (manager: EntityManager) => Promise<unknown>) =>
      action(manager),
    );
    const service = new CustomerManagementService({ transaction } as unknown as DataSource);
    jest.spyOn(service, 'detail').mockResolvedValue({ id: customerId } as never);

    const reason = 'Chăm sóc hội viên lâu năm';
    await service.updateVip(admin, customerId, { isVip: true, level: 3, reason });
    const queries = managerQuery.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(managerQuery).toHaveBeenCalledTimes(3);
    expect(queries[2][1][0]).toBe(`mocmaria.customer.vip.${customerId}`);
    expect(JSON.parse(queries[2][1][1] as string) as unknown).toMatchObject({
      isVip: true,
      level: 3,
      expiresAt: null,
      reason,
      updatedBy: admin.id,
    });
    const saves = save.mock.calls as unknown as Array<
      [unknown, { event: string; actorUserId: string; targetUserId: string; metadata: object }]
    >;
    expect(saves[0][1]).toMatchObject({
      event: 'customer.vip.updated',
      actorUserId: admin.id,
      targetUserId: customerId,
      metadata: { newVip: true, reason },
    });
  });

  it('keeps internal customer notes out of the audit metadata', async () => {
    const save = jest.fn();
    const managerQuery = jest
      .fn()
      .mockResolvedValueOnce([{ id: customerId }])
      .mockResolvedValue([]);
    const manager = { query: managerQuery, save } as unknown as EntityManager;
    const transaction = jest.fn((action: (manager: EntityManager) => Promise<unknown>) =>
      action(manager),
    );
    const service = new CustomerManagementService({ transaction } as unknown as DataSource);
    jest.spyOn(service, 'detail').mockResolvedValue({ id: customerId } as never);
    await service.updateNote(admin, customerId, { note: 'Chỉ dùng cho chăm sóc nội bộ' });
    const queries = managerQuery.mock.calls as unknown as Array<[string, unknown[]]>;
    const saves = save.mock.calls as unknown as Array<
      [unknown, { event: string; metadata: object }]
    >;
    expect(queries[1][1][0]).toBe(`mocmaria.customer.care.${customerId}`);
    expect(saves[0][1]).toMatchObject({
      event: 'customer.note.updated',
      metadata: { operation: 'care_note_saved' },
    });
  });
});
