import { ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource, EntityManager } from 'typeorm';
import type { ProviderDisplayService } from '../provider-display/provider-display.service';
import type { AuthUserContext } from '../identity/identity.types';
import { CreateProviderReviewDto, UpdateProviderReviewPolicyDto } from './provider-reviews.dto';
import { ProviderReviewsService, REVIEW_POLICY_KEY } from './provider-reviews.service';

const customer = {
  id: 'customer-123',
  roles: ['CUSTOMER'],
  permissions: ['customer.portal'],
} as AuthUserContext;
const admin = {
  id: 'admin-123',
  roles: ['SUPER_ADMIN'],
  permissions: ['staff.manage'],
} as AuthUserContext;

function harness(
  vipOnly: boolean,
  vipRecord?: { isVip: boolean; expiresAt: string | null },
): { service: ProviderReviewsService; calls: Array<{ sql: string; params: unknown[] }> } {
  let settings = { vipOnly, version: vipOnly ? 1 : 0 };
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    let result: object[] = [];
    if (sql.startsWith('SELECT value FROM app_metadata')) {
      result =
        params[0] === REVIEW_POLICY_KEY
          ? [{ value: settings }]
          : vipRecord
            ? [{ value: vipRecord }]
            : [];
    }
    if (sql.startsWith('INSERT INTO app_metadata(')) {
      const parsed: unknown = JSON.parse(params[1] as string);
      settings = parsed as typeof settings;
    }
    if (sql.includes('SELECT a.id FROM appointments')) result = [{ id: 'appointment-123' }];
    if (sql.includes('INSERT INTO provider_reviews('))
      result = [
        {
          id: 'review-123',
          visibility: 'HIDDEN',
          stars: 5,
          comment: 'Nhân viên phục vụ rất chu đáo',
          version: 1,
        },
      ];
    return Promise.resolve(result);
  });
  const db = {
    query,
    transaction: (fn: (m: EntityManager) => unknown) => fn({ query } as unknown as EntityManager),
  } as unknown as DataSource;
  const service = new ProviderReviewsService(db, {} as ProviderDisplayService);
  return { service, calls };
}

describe('VIP-only provider reviews policy', () => {
  it('keeps existing completed-appointment flow enabled by default', async () => {
    const { service } = harness(false);
    expect(await service.reviewAccess(customer)).toMatchObject({ vipOnly: false, canReview: true });
  });
  it('blocks regular and expired VIP accounts at write boundary, without touching reviews', async () => {
    for (const record of [undefined, { isVip: true, expiresAt: '2020-01-01T00:00:00Z' }]) {
      const { service, calls } = harness(true, record);
      expect(await service.reviewAccess(customer)).toMatchObject({
        vipOnly: true,
        canReview: false,
      });
      await expect(
        service.create(customer, {
          appointmentId: 'appointment-123',
          providerApplicationId: 'provider-123',
          stars: 5,
          comment: 'Nhân viên phục vụ rất chu đáo',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(calls.some((x) => x.sql.includes('INSERT INTO provider_reviews('))).toBe(false);
    }
  });
  it('allows currently active VIPs to rate only through the existing appointment constraint', async () => {
    const { service, calls } = harness(true, { isVip: true, expiresAt: '2099-01-01T00:00:00Z' });
    expect(await service.reviewAccess(customer)).toEqual({
      vipOnly: true,
      isVip: true,
      canReview: true,
    });
    const saved = await service.create(customer, {
      appointmentId: 'appointment-123',
      providerApplicationId: 'provider-123',
      stars: 5,
      comment: 'Nhân viên phục vụ rất chu đáo',
    });
    expect(saved.visibility).toBe('HIDDEN');
    expect(calls.some((x) => x.sql.includes("a.status='COMPLETED'"))).toBe(true);
  });
  it('requires authorized admin, version match and audit reason for policy changes', async () => {
    const { service, calls } = harness(false);
    await expect(service.adminPolicy(customer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updatePolicy(admin, {
        vipOnly: true,
        expectedVersion: 1,
        reason: 'Only members may rate',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const result = await service.updatePolicy(admin, {
      vipOnly: true,
      expectedVersion: 0,
      reason: 'Chỉ duyệt đánh giá từ VIP còn hạn.',
    });
    expect(result).toEqual({ vipOnly: true, version: 1 });
    expect(calls.find((x) => x.sql.includes('INSERT INTO audit_logs('))?.params[2]).toContain(
      'reason',
    );
  });
  it('rejects short/junk feedback and policy reasons during DTO validation', async () => {
    const dto = plainToInstance(CreateProviderReviewDto, {
      appointmentId: '2a18311e-14d4-4b15-bf71-339bd0665f2e',
      providerApplicationId: '6b0483fa-490b-4a78-adbc-1f77be1512bc',
      stars: 5,
      comment: 'Ổn',
    });
    expect((await validate(dto)).some((x) => x.property === 'comment')).toBe(true);
    const policy = plainToInstance(UpdateProviderReviewPolicyDto, {
      vipOnly: 'true',
      expectedVersion: -1,
      reason: 'x',
    });
    expect((await validate(policy)).map((x) => x.property)).toEqual(
      expect.arrayContaining(['vipOnly', 'expectedVersion', 'reason']),
    );
  });
});
