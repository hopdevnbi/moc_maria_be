import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import type { Inquiry } from './experience.service';
import { AdminAppointmentInquiriesService } from './admin-appointment-inquiries.service';
import type { KtvChatService } from '../ktv-chat/ktv-chat.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['SUPER_ADMIN'],
  permissions: [PERMISSIONS.CUSTOMER_MANAGE],
} as AuthUserContext;
const id = 'a'.repeat(64);
const inquiry = {
  id,
  signature: 'private-signature',
  customerId: '22222222-2222-4222-8222-222222222222',
  customerName: 'Khách đặt lịch',
  providerId: '33333333-3333-4333-8333-333333333333',
  providerUserId: '44444444-4444-4444-8444-444444444444',
  providerName: 'KTV An',
  serviceId: 'gội đầu',
  serviceName: 'Gội đầu dưỡng sinh',
  requestedAt: '2026-10-15T13:00:00Z',
  createdAt: '2026-10-13T10:00:00Z',
  location: 'AT_BRANCH',
  address: 'Cơ sở Mộc Maria',
  notes: 'Cần tư vấn trước',
  status: 'PENDING',
} as Inquiry;
const row = {
  value: inquiry,
  updatedAt: '2026-10-13T11:00:00Z',
  customerEmail: 'example@example.com',
  customerPhone: '0901234567',
};

describe('Admin appointment inquiries contract', () => {
  it('requires both an admin role and customers.manage permission', async () => {
    const query = jest.fn();
    const service = new AdminAppointmentInquiriesService({ query } as unknown as DataSource);
    await expect(
      service.list({ ...actor, roles: ['RECEPTIONIST'] }, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.list({ ...actor, permissions: [] }, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('filters and paginates persisted requests without leaking signature or providerUserId', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ all: 3, pending: 2, contacted: 1, declined: 0, cancelled: 0 }])
      .mockResolvedValueOnce([row]);
    const service = new AdminAppointmentInquiriesService({ query } as unknown as DataSource);
    const result = await service.list(actor, {
      status: 'PENDING',
      q: "Khách' đặt lịch",
      page: 1,
      limit: 1,
    });
    expect(result).toMatchObject({
      total: 2,
      hasMore: true,
      counts: { ALL: 3, PENDING: 2, CONTACTED: 1 },
      items: [
        {
          customerEmail: 'example@example.com',
          allowedActions: ['CONTACTED', 'DECLINED', 'CANCELLED'],
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('signature');
    expect(result.items[0]).not.toHaveProperty('providerUserId');
    const calls = query.mock.calls as unknown as Array<[string, unknown]>;
    expect(calls[0]?.[1]).toEqual(["Khách' đặt lịch"]);
    expect(calls[1]?.[1]).toEqual(["Khách' đặt lịch", 'PENDING', 1, 0]);
  });

  it('reads original audit history while withholding internal fields', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([
        { event: 'appointment.inquiry.created', reason: null, status: null, createdAt: new Date() },
      ]);
    const result = await new AdminAppointmentInquiriesService({
      query,
    } as unknown as DataSource).detail(actor, id);
    expect(result.history).toHaveLength(1);
    expect(result).not.toHaveProperty('signature');
    expect(result.customerPhone).toBe('0901234567');
    const calls = query.mock.calls as unknown as Array<[string, unknown]>;
    expect(calls[0]?.[1]).toEqual(['mocmaria.inquiry.' + id]);
  });

  it('rejects empty reasons and protects accepted requests against conflicting updates', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ value: { ...inquiry, status: 'CONTACTED' } }]),
      save: jest.fn(),
    };
    const transaction = jest.fn(async (callback: (m: EntityManager) => Promise<unknown>) =>
      callback(manager as unknown as EntityManager),
    );
    const service = new AdminAppointmentInquiriesService({ transaction } as unknown as DataSource);
    await expect(
      service.update(actor, id, { status: 'CONTACTED', reason: '          ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
    await expect(
      service.update({ ...actor, roles: ['ADMIN'] }, id, {
        status: 'CONTACTED',
        reason: 'Đã liên hệ khách hàng.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledTimes(2);
  });
});

describe('Super Admin inquiry intake controls', () => {
  it('creates a real inquiry record, never a completed appointment', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT u.id,u.display_name'))
        return Promise.resolve([{ id: inquiry.customerId, display_name: 'Khách đặt lịch' }]);
      if (sql.includes('SELECT p.user_id'))
        return Promise.resolve([{ user_id: inquiry.providerUserId }]);
      return Promise.resolve([]);
    });
    const db = {
      transaction: (fn: (m: EntityManager) => unknown) =>
        fn({ query, save: jest.fn() } as unknown as EntityManager),
    } as unknown as DataSource;
    const chat = {
      directory: jest.fn().mockResolvedValue([
        {
          id: inquiry.providerId,
          publicName: inquiry.providerName,
          services: [{ id: inquiry.serviceId, name: inquiry.serviceName }],
        },
      ]),
    } as unknown as KtvChatService;
    const service = new AdminAppointmentInquiriesService(db, chat);
    jest.spyOn(service, 'detail').mockResolvedValue({
      ...inquiry,
      customerEmail: null,
      customerPhone: null,
      updatedAt: inquiry.createdAt,
      allowedActions: [],
      history: [],
    });
    const result = await service.create(actor, {
      customerId: inquiry.customerId,
      providerId: inquiry.providerId,
      serviceId: inquiry.serviceId,
      location: inquiry.location,
      address: inquiry.address,
      requestedAt: '2099-10-15T10:00:00Z',
      reason: 'Khách nhờ nhân viên tạo giúp yêu cầu.',
    });
    expect(result.id).toBe(inquiry.id);
    const inserted = calls.find((c) => c.sql.startsWith('INSERT INTO app_metadata('));
    expect(inserted).toBeDefined();
    expect(JSON.parse(String(inserted?.params[1]))).toMatchObject({
      status: 'PENDING',
      createdByAdmin: true,
    });
    expect(calls.some((c) => /INSERT INTO appointments(?:\s|\()/i.test(c.sql))).toBe(false);
  });

  it('soft-archives and cancels a request while retaining its audit trail', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT value FROM app_metadata'))
        return Promise.resolve([{ value: { ...inquiry, status: 'CONTACTED' } }]);
      return Promise.resolve([]);
    });
    const save = jest.fn().mockResolvedValue(undefined);
    const db = {
      transaction: (fn: (m: EntityManager) => unknown) =>
        fn({ query, save } as unknown as EntityManager),
    } as unknown as DataSource;
    const service = new AdminAppointmentInquiriesService(db);
    jest.spyOn(service, 'detail').mockResolvedValue({
      ...inquiry,
      customerEmail: null,
      customerPhone: null,
      updatedAt: inquiry.createdAt,
      allowedActions: [],
      history: [],
    });
    await service.archive(
      actor,
      inquiry.id,
      { reason: 'Yêu cầu đã được hủy theo yêu cầu khách.' },
      true,
    );
    const update = calls.find((c) => c.sql.startsWith('UPDATE app_metadata SET'));
    const updated = JSON.parse(String(update?.params[1])) as {
      status: string;
      archivedAt: string;
    };
    expect(updated.status).toBe('CANCELLED');
    expect(Date.parse(updated.archivedAt)).toBeGreaterThan(0);
    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'appointment.inquiry.admin_archived' }),
    );
    expect(calls.some((c) => /DELETE FROM/i.test(c.sql))).toBe(false);
  });
});
