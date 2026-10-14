import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { ChangeFulfillmentDto, ConfirmInquiryDto } from './inquiry-fulfillment.dto';
import { InquiryFulfillmentService } from './inquiry-fulfillment.service';

const id = 'a'.repeat(64);
const owner = '11111111-1111-4111-8111-111111111111';
const customer = '22222222-2222-4222-8222-222222222222';
const provider = '33333333-3333-4333-8333-333333333333';
const admin = {
  id: owner,
  roles: ['SUPER_ADMIN'],
  permissions: ['customers.manage'],
} as AuthUserContext;
const ktv = {
  id: '44444444-4444-4444-8444-444444444444',
  roles: ['THERAPIST'],
  permissions: [],
} as unknown as AuthUserContext;

function harness(): {
  service: InquiryFulfillmentService;
  logs: Array<{ sql: string; params: unknown[] }>;
  query: jest.Mock;
  save: jest.Mock;
  getInquiry: () => Record<string, unknown>;
} {
  let inquiry: Record<string, unknown> = {
    id,
    customerId: customer,
    customerName: 'Khách thử',
    providerId: provider,
    providerUserId: ktv.id,
    providerName: 'KTV Thu Hà',
    status: 'CONTACTED',
    location: 'AT_BRANCH',
    serviceName: 'Massage thảo dược',
    serviceId: 'demo-relaxation',
    requestedAt: '2026-10-13T06:00:00.000Z',
  };
  let appointment: Record<string, unknown> | null = null;
  const logs: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    logs.push({ sql, params });
    if (sql.startsWith('SELECT value FROM app_metadata'))
      return Promise.resolve([{ value: inquiry }]);
    if (sql.startsWith('SELECT id FROM branches'))
      return Promise.resolve([{ id: '55555555-5555-4555-8555-555555555555' }]);
    if (sql.includes('AS customer_ok'))
      return Promise.resolve([{ customer_ok: true, provider_ok: true }]);
    if (sql.includes('FROM appointments a JOIN appointment_staff')) return Promise.resolve([]);
    if (sql.startsWith('INSERT INTO appointments(')) {
      appointment = {
        id: '66666666-6666-4666-8666-666666666666',
        status: 'CONFIRMED',
        version: 1,
        starts_at: new Date(params[3] as string),
        ends_at: new Date(params[4] as string),
        customer_user_id: customer,
      };
      return Promise.resolve([appointment]);
    }
    if (sql.startsWith('SELECT id,status,version,starts_at'))
      return Promise.resolve(appointment ? [appointment] : []);
    if (sql.includes('UPDATE appointments SET')) {
      if (
        !appointment ||
        appointment['version'] !== params[2] ||
        appointment['status'] !== params[3]
      )
        return Promise.resolve([]);
      appointment = {
        ...appointment,
        status: params[1],
        version: (appointment['version'] as number) + 1,
      };
      return Promise.resolve([appointment]);
    }
    if (sql.startsWith('UPDATE app_metadata SET')) {
      inquiry = JSON.parse(params[1] as string) as Record<string, unknown>;
      return Promise.resolve([]);
    }
    if (sql.includes('FROM appointment_status_history')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
  const save = jest.fn().mockResolvedValue({});
  const db = {
    query,
    transaction: (fn: (m: EntityManager) => unknown) =>
      fn({ query, save } as unknown as EntityManager),
  } as unknown as DataSource;
  return {
    service: new InquiryFulfillmentService(db),
    logs,
    query,
    save,
    getInquiry: () => inquiry,
  };
}

describe('Verified fulfillment of previously contacted legacy inquiries', () => {
  const confirmation: ConfirmInquiryDto = {
    startsAt: '2026-10-13T06:00:00.000Z',
    endsAt: '2026-10-13T07:00:00.000Z',
    customerAgreementConfirmed: true,
    historicalBookingConfirmed: true,
    reason: 'Super Admin đã xác nhận trực tiếp với khách và KTV.',
  };

  it('requires a real Super Admin before reading or creating appointments', async () => {
    const { service, query } = harness();
    await expect(
      service.confirm({ ...admin, roles: ['ADMIN'] }, id, confirmation),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects retrospective confirmation without historical attestation', async () => {
    const { service, query } = harness();
    await expect(
      service.confirm(admin, id, { ...confirmation, historicalBookingConfirmed: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('creates one real linked appointment in CONFIRMED status and never creates fake billing or completed service', async () => {
    const { service, logs, getInquiry } = harness();
    const value = await service.confirm(admin, id, confirmation);
    expect(value).toMatchObject({
      status: 'CONFIRMED',
      version: 1,
      appointmentId: '66666666-6666-4666-8666-666666666666',
    });
    expect(getInquiry()).toMatchObject({ status: 'CONTACTED', fulfillmentStatus: 'CONFIRMED' });
    expect(logs.filter((x) => x.sql.startsWith('INSERT INTO appointments('))).toHaveLength(1);
    expect(logs.filter((x) => x.sql.startsWith('INSERT INTO appointment_staff('))).toHaveLength(1);
    expect(
      logs.filter((x) => x.sql.startsWith('INSERT INTO appointment_status_history(')),
    ).toHaveLength(1);
    expect(
      logs.some((x) => /INSERT INTO (appointment_quotes|appointment_items)/i.test(x.sql)),
    ).toBe(false);
    await expect(service.confirm(admin, id, confirmation)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires start-then-complete for KTV and evidence of real finished service', async () => {
    const { service, getInquiry } = harness();
    await service.confirm(admin, id, confirmation);
    await expect(
      service.change(
        ktv,
        id,
        {
          status: 'COMPLETED',
          expectedVersion: 1,
          reason: 'Đã thực hiện đầy đủ dịch vụ',
          servicePerformedConfirmed: true,
        },
        'PROVIDER',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const started = await service.change(
      ktv,
      id,
      { status: 'IN_SERVICE', expectedVersion: 1, reason: 'Đã bắt đầu chăm sóc thực tế' },
      'PROVIDER',
    );
    expect(started).toMatchObject({ status: 'IN_SERVICE', version: 2 });
    await expect(
      service.change(
        ktv,
        id,
        { status: 'COMPLETED', expectedVersion: 2, reason: 'Dịch vụ hoàn thành đủ thời lượng' },
        'PROVIDER',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const finished = await service.change(
      ktv,
      id,
      {
        status: 'COMPLETED',
        expectedVersion: 2,
        reason: 'Dịch vụ hoàn thành đủ thời lượng',
        servicePerformedConfirmed: true,
      },
      'PROVIDER',
    );
    expect(finished).toMatchObject({ status: 'COMPLETED', version: 3 });
    expect(getInquiry()).toMatchObject({ status: 'CONTACTED', fulfillmentStatus: 'COMPLETED' });
  });

  it('blocks mismatched KTV, stale versions, and any re-completion', async () => {
    const { service } = harness();
    await service.confirm(admin, id, confirmation);
    await expect(
      service.change(
        { ...ktv, id: owner },
        id,
        { status: 'IN_SERVICE', expectedVersion: 1, reason: 'Tôi bắt đầu phục vụ khách' },
        'PROVIDER',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.change(
        admin,
        id,
        { status: 'IN_SERVICE', expectedVersion: 2, reason: 'Đã bắt đầu phục vụ khách' },
        'ADMIN',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.change(
      admin,
      id,
      {
        status: 'COMPLETED',
        expectedVersion: 1,
        reason: 'Xác nhận thực tế dịch vụ đã xong',
        servicePerformedConfirmed: true,
      },
      'ADMIN',
    );
    await expect(
      service.change(
        admin,
        id,
        {
          status: 'COMPLETED',
          expectedVersion: 2,
          reason: 'Làm lại trạng thái đã hoàn thành',
          servicePerformedConfirmed: true,
        },
        'ADMIN',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('DTO rejects fabricated confirmation and invalid state changes', async () => {
    const confirm = plainToInstance(ConfirmInquiryDto, {
      startsAt: 'bad',
      endsAt: 'bad',
      customerAgreementConfirmed: 'true',
      reason: 'x',
    });
    const change = plainToInstance(ChangeFulfillmentDto, {
      status: 'PENDING',
      expectedVersion: -1,
      reason: 'x',
    });
    expect((await validate(confirm)).map((e) => e.property)).toEqual(
      expect.arrayContaining(['startsAt', 'endsAt', 'customerAgreementConfirmed', 'reason']),
    );
    expect((await validate(change)).map((e) => e.property)).toEqual(
      expect.arrayContaining(['status', 'expectedVersion', 'reason']),
    );
  });
});
