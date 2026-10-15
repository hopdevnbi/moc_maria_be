import { ForbiddenException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import { GiftReportService, giftReportCsv, safeCsvCell } from './gift-report.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['SUPER_ADMIN'],
  permissions: ['admin.portal'],
  isActive: true,
} as AuthUserContext;
const id = '22222222-2222-4222-8222-222222222222';
function fixture({ mismatch = false } = {}): { service: GiftReportService; queries: string[] } {
  const queries: string[] = [];
  const query = jest.fn((sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM gift_event_campaigns WHERE id='))
      return Promise.resolve([
        {
          id,
          code: 'oct-2026',
          title: 'Mở hộp quà',
          status: 'LIVE',
          budget_cap_vnd: '100000',
          budget_reserved_vnd: mismatch ? '60000' : '50000',
        },
      ]);
    if (sql.includes('FROM gift_event_rewards WHERE event_id=') && sql.includes('history'))
      return Promise.resolve([
        {
          entries: '1',
          issued: '1',
          redeemed: '0',
          expired: '0',
          voided: '0',
          outstanding: '1',
          history: '0',
          liability: '50000',
        },
      ]);
    if (sql.includes('FROM gift_event_prizes p LEFT JOIN'))
      return Promise.resolve([
        {
          id: 'p1',
          name: 'Voucher 50k',
          kind: 'VOUCHER_FIXED',
          stock_total: 10,
          stock_issued: 1,
          issued: '1',
          redeemed: '0',
          expired: '0',
          liability: '50000',
        },
      ]);
    if (sql.includes('FROM gift_event_rewards r') && sql.includes('JOIN branches b'))
      return Promise.resolve([]);
    if (sql.includes("AT TIME ZONE 'Asia/Ho_Chi_Minh'"))
      return Promise.resolve([{ day: '2026-10-15', n: '1' }]);
    return Promise.resolve([]);
  });
  const db = {
    transaction: (_isolation: string, fn: (m: EntityManager) => unknown) =>
      fn({ query } as unknown as EntityManager),
  } as unknown as DataSource;
  return { service: new GiftReportService(db, new GiftEventsService(db)), queries };
}
beforeEach(() => {
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
});
afterEach(() => delete process.env['GIFT_EVENTS_ENABLED']);
describe('P13 reconciliation and report safety', () => {
  it('denies ordinary Admin all metrics', async () => {
    const { service, queries } = fixture();
    await expect(service.report({ ...actor, roles: ['ADMIN'] }, id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(queries).toHaveLength(0);
  });
  it('uses repeatable-read to balance one issued voucher against stock and reserved budget', async () => {
    const { service, queries } = fixture();
    const data = await service.report(actor, id);
    expect(data).toMatchObject({
      entries: 1,
      issued: 1,
      redeemed: 0,
      reconciled: true,
      liabilityIssuedVnd: 50000,
      budgetReservedVnd: 50000,
    });
    expect(data.prizes[0].stockDelta).toBe(0);
    expect(queries.some((sql) => sql.includes("AT TIME ZONE 'Asia/Ho_Chi_Minh'"))).toBe(true);
  });
  it('raises a discrepancy instead of hiding mismatch', async () => {
    const { service } = fixture({ mismatch: true });
    const data = await service.report(actor, id);
    expect(data.reconciled).toBe(false);
    expect(data.discrepancies).toContain('LIABILITY_BUDGET_MISMATCH');
  });
  it('escapes CSV formulas, quotes and newlines and never silently omits BOM', () => {
    expect(safeCsvCell('=1+1')).toBe('"\'=1+1"');
    expect(safeCsvCell('+cmd')).toBe('"\'+cmd"');
    expect(safeCsvCell('Nice "voucher"')).toBe('"Nice ""voucher"""');
    const report = {
      ...({} as ReturnType<GiftReportService['report']> extends Promise<infer R> ? R : never),
      code: '=EXFILTRATE()',
      title: 'Mộc Maria',
      timezone: 'Asia/Ho_Chi_Minh' as const,
      generatedAt: '2026-10-15',
      entries: 1,
      issued: 1,
      redeemed: 0,
      expired: 0,
      voided: 0,
      outstanding: 1,
      budgetCapVnd: 100000,
      budgetReservedVnd: 50000,
      liabilityIssuedVnd: 50000,
      discrepancies: [],
      reconciled: true,
      prizes: [],
      branches: [],
      daily: [],
    };
    expect(giftReportCsv(report).startsWith('\uFEFF')).toBe(true);
    expect(giftReportCsv(report)).toContain("'=EXFILTRATE()");
  });
});
