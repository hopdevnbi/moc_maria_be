import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { effectiveGiftStatus, normalizeGiftTiers, assertGiftTimeWindow } from './gift-events.dto';
import { GiftEventsService } from './gift-events.service';

const superAdmin = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['SUPER_ADMIN'],
  permissions: ['admin.portal'],
  isActive: true,
} as AuthUserContext;

const draft = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'qua-an-nhien',
  slug: 'an-nhien',
  title: 'Mở hộp quà an nhiên',
  description: '',
  terms_text: 'Chào mừng đến sự kiện của Mộc Maria',
  terms_version: 1,
  hero_url: null,
  status: 'DRAFT',
  start_at: null,
  end_at: null,
  budget_cap_vnd: '1000000',
  budget_reserved_vnd: '0',
  version: 1,
};

beforeEach(() => {
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
});
afterEach(() => {
  delete process.env['GIFT_EVENTS_ENABLED'];
});

describe('P05 Gift event tiers and lifecycle', () => {
  it('defaults to only STANDARD and exact VIP n; no wildcard VIP escalation', () => {
    expect(normalizeGiftTiers(undefined)).toEqual(['STANDARD']);
    expect(normalizeGiftTiers(['VIP2', 'STANDARD', 'VIP2'])).toEqual(['VIP2', 'STANDARD']);
    expect(normalizeGiftTiers(['VIP99'])).toEqual(['VIP99']);
    for (const tiers of [[], ['VIP0'], ['VIP100'], ['VIP'], ['ALL'], ['STANDARD', 'VIP01']])
      expect(() => normalizeGiftTiers(tiers)).toThrow();
  });
  it('uses server clock and an exclusive end boundary', () => {
    const a = new Date('2026-10-15T10:00:00Z'),
      b = new Date('2026-10-15T11:00:00Z');
    expect(effectiveGiftStatus('SCHEDULED', a, b, new Date('2026-10-15T09:59:59Z'))).toBe(
      'SCHEDULED',
    );
    expect(effectiveGiftStatus('SCHEDULED', a, b, a)).toBe('LIVE');
    expect(effectiveGiftStatus('LIVE', a, b, b)).toBe('ENDED');
    expect(effectiveGiftStatus('PAUSED', a, b, a)).toBe('PAUSED');
    expect(() => assertGiftTimeWindow(a.toISOString(), a.toISOString())).toThrow();
  });
  it('disables event API before schema/operations released', async () => {
    delete process.env['GIFT_EVENTS_ENABLED'];
    const query = jest.fn();
    const db = { query } as unknown as DataSource;
    const service = new GiftEventsService(db);
    await expect(service.list(superAdmin)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await service.current()).toMatchObject({ status: 'DISABLED', campaign: null });
    expect(query).not.toHaveBeenCalled();
  });
  it('blocks non Super Admin before database reads and writes', async () => {
    const query = jest.fn();
    const db = { query } as unknown as DataSource;
    const service = new GiftEventsService(db);
    await expect(service.list({ ...superAdmin, roles: ['ADMIN'] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('creates a DRAFT and the one explicit STANDARD tier in one transaction', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [],
      query = jest.fn((sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return Promise.resolve(
          sql.startsWith('INSERT INTO gift_event_campaigns') ? [{ id: draft.id }] : [],
        );
      });
    const db = {
      query,
      transaction: (fn: (m: EntityManager) => unknown) => fn({ query } as unknown as EntityManager),
    } as unknown as DataSource;
    const service = new GiftEventsService(db);
    jest
      .spyOn(service, 'detail')
      .mockResolvedValue({} as Awaited<ReturnType<GiftEventsService['detail']>>);
    await service.create(superAdmin, { code: draft.code, slug: draft.slug, title: draft.title });
    const insert = queries.find((q) => q.sql.includes('INSERT INTO gift_event_tiers('));
    expect(insert?.params).toEqual([draft.id, 'STANDARD']);
    expect(
      queries.find((q) => q.sql.startsWith('INSERT INTO gift_event_campaigns'))?.params,
    ).toContain(0);
  });
  it('rejects edit when version is stale or campaign has become LIVE', async () => {
    const query = jest.fn((sql: string) =>
      Promise.resolve(sql.startsWith('SELECT * FROM gift_event_campaigns') ? [draft] : []),
    );
    const db = {
      query,
      transaction: (fn: (m: EntityManager) => unknown) => fn({ query } as unknown as EntityManager),
    } as unknown as DataSource;
    const service = new GiftEventsService(db);
    await expect(
      service.update(superAdmin, draft.id, {
        expectedVersion: 2,
        reason: 'Thay đổi cấu hình event',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      query.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE gift_event_campaigns')),
    ).toBe(false);
  });
});
