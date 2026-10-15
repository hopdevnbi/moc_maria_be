import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftAbuseService } from './gift-abuse.service';
import { GiftEventsService } from './gift-events.service';

const user = { id: '11111111-1111-4111-8111-111111111111' } as AuthUserContext;
const scope = '22222222-2222-4222-8222-222222222222';
function fixture(): {
  service: GiftAbuseService;
  hits: Map<string, number>;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const hits = new Map<string, number>();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    const key = params.slice(0, 4).join(':');
    const next = (hits.get(key) || 0) + 1;
    if (next > Number(params[4])) return Promise.resolve([]);
    hits.set(key, next);
    return Promise.resolve([{ attempts: next }]);
  });
  const db = { query } as unknown as DataSource;
  return { service: new GiftAbuseService(db, new GiftEventsService(db)), hits, calls };
}
beforeEach(() => {
  process.env['GIFT_EVENTS_ENABLED'] = 'true';
});
afterEach(() => delete process.env['GIFT_EVENTS_ENABLED']);
describe('P14 database-backed event abuse prevention', () => {
  it('allows only 12 opening attempts per 10 minutes per actor/event', async () => {
    const { service, calls } = fixture();
    for (let i = 0; i < 12; i++) await service.consume(user, 'OPEN', scope);
    await expect(service.consume(user, 'OPEN', scope)).rejects.toMatchObject({ status: 429 });
    expect(calls[0].sql).toContain('ON CONFLICT');
    expect(calls[0].sql).toContain('WHERE gift_event_rate_limits.attempts<$5');
    expect(calls[0].params[4]).toBe(12);
  });
  it('keeps independent buckets for QR, verify, redeem', async () => {
    const { service } = fixture();
    for (let i = 0; i < 8; i++) await service.consume(user, 'ISSUE_QR', scope);
    await expect(service.consume(user, 'ISSUE_QR', scope)).rejects.toMatchObject({ status: 429 });
    await expect(service.consume(user, 'VERIFY', scope)).resolves.toBeUndefined();
    await expect(service.consume(user, 'REDEEM', scope)).resolves.toBeUndefined();
  });
  it('rejects invalid scope before database query', async () => {
    const { service, calls } = fixture();
    await expect(service.consume(user, 'OPEN', '')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.consume(user, 'OPEN', 'x'.repeat(101))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(calls).toHaveLength(0);
  });
  it('stays off when event feature is disabled', async () => {
    process.env['GIFT_EVENTS_ENABLED'] = 'false';
    const { service, calls } = fixture();
    await expect(service.consume(user, 'OPEN', scope)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(calls).toHaveLength(0);
  });
});
