import { BadRequestException } from '@nestjs/common';
import { effectiveVipStatus, normalizedLimit } from './membership.service';

describe('VIP membership status', () => {
  const now = new Date('2026-10-10T00:00:00.000Z');
  const member = {
    customerUserId: 'user-1',
    activeSince: new Date('2026-10-09T00:00:00.000Z'),
    expiresAt: null,
    status: 'ACTIVE' as const,
  };
  const request = {
    id: 'req-1',
    customerUserId: 'user-1',
    status: 'PENDING' as const,
    note: null,
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
  };
  it('never grants VIP for a pending request', () => {
    expect(effectiveVipStatus(undefined, request, now)).toBe('PENDING');
    expect(effectiveVipStatus(undefined, undefined, now)).toBe('STANDARD');
  });
  it('only considers active, unexpired membership VIP', () => {
    expect(effectiveVipStatus(member, undefined, now)).toBe('VIP');
    expect(
      effectiveVipStatus({ ...member, expiresAt: new Date('2026-10-09') }, undefined, now),
    ).toBe('EXPIRED');
    expect(effectiveVipStatus({ ...member, status: 'SUSPENDED' }, undefined, now)).toBe(
      'SUSPENDED',
    );
  });
  it('caps list requests and rejects malicious limit strings', () => {
    expect(normalizedLimit()).toBe(30);
    expect(normalizedLimit('999')).toBe(100);
    expect(normalizedLimit('1')).toBe(1);
    expect(() => normalizedLimit('1;DROP TABLE users')).toThrow(BadRequestException);
  });
});
