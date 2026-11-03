import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { CustomerExperienceService, type Inquiry } from './experience.service';
import { ReplyInquiryDto } from './experience.dto';

const id = 'a'.repeat(64);
const actor = { id: 'technician', roles: ['THERAPIST'] } as AuthUserContext;
const reason = 'Lịch làm việc bị trùng giờ nên tôi không thể tiếp nhận lịch chăm sóc này.';

function harness(overrides: Partial<Inquiry> = {}): {
  service: CustomerExperienceService;
  query: jest.Mock;
  save: jest.Mock;
  getInquiry: () => Inquiry;
} {
  let value = {
    id,
    customerId: 'customer',
    providerUserId: actor.id,
    status: 'CONTACTED',
    ...overrides,
  } as Inquiry;
  const save = jest.fn().mockResolvedValue({});
  const query = jest.fn().mockImplementation((sql: string, params: unknown[]) => {
    if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    if (sql.startsWith('SELECT value FROM app_metadata')) return Promise.resolve([{ value }]);
    if (sql.startsWith('INSERT INTO app_metadata')) {
      value = JSON.parse(params[1] as string) as Inquiry;
      return Promise.resolve([]);
    }
    throw Error(`Unexpected SQL: ${sql}`);
  });
  const manager = { query, save } as unknown as EntityManager;
  const db = {
    transaction: (fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
  } as DataSource;
  const service = new CustomerExperienceService(db, {} as never, {} as never, {} as never);
  return { service, query, save, getInquiry: () => value };
}

describe('KTV refusal with audit reason', () => {
  it('allows assigned KTV to decline a contacted request and records reason for both parties', async () => {
    const { service, save, getInquiry } = harness();
    const response = await service.replyInquiry(actor, id, { status: 'DECLINED', reason });
    expect(response).toMatchObject({ status: 'DECLINED', declineReason: reason });
    expect(getInquiry().declineReason).toBe(reason);
    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: 'appointment.inquiry.updated',
        actorUserId: actor.id,
        targetUserId: 'customer',
        metadata: { inquiryId: id, status: 'DECLINED', reason },
      }),
    );
  });

  it('rejects missing or short reasons, unauthorized KTVs and official appointments', async () => {
    const { service, save } = harness();
    await expect(service.replyInquiry(actor, id, { status: 'DECLINED' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.replyInquiry(actor, id, { status: 'DECLINED', reason: 'quá ngắn' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.replyInquiry({ ...actor, id: 'other' }, id, { status: 'DECLINED', reason }),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    const official = harness({ appointmentId: 'official' });
    await expect(
      official.service.replyInquiry(actor, id, { status: 'DECLINED', reason }),
    ).rejects.toBeInstanceOf(ConflictException);
    const customer = harness();
    await expect(
      customer.service.replyInquiry({ ...actor, id: 'customer', roles: ['CUSTOMER'] }, id, {
        status: 'DECLINED',
        reason,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the decline reason optional for accepting a request, but validates a provided reason', async () => {
    expect(await validate(plainToInstance(ReplyInquiryDto, { status: 'CONTACTED' }))).toHaveLength(
      0,
    );
    const invalid = await validate(
      plainToInstance(ReplyInquiryDto, { status: 'DECLINED', reason: 'short' }),
    );
    expect(invalid.map((e) => e.property)).toContain('reason');
  });
});
