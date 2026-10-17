import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { AdminDashboardService, dashboardRange } from './admin-dashboard.service';

const actor: AuthUserContext = {
  id: '11111111-1111-4111-8111-111111111111',
  email: null,
  phone: null,
  displayName: 'Administrator',
  isActive: true,
  mustChangePassword: false,
  sessionId: '22222222-2222-4222-8222-222222222222',
  roles: ['SUPER_ADMIN'],
  permissions: ['customers.manage', 'staff.manage'],
};

describe('Operational dashboard', () => {
  it('uses Vietnamese calendar boundaries, including month/year rollovers', () => {
    const day = dashboardRange('day', '2026-10-17');
    expect(day.from).toBe('2026-10-16T17:00:00.000Z');
    expect(day.to).toBe('2026-10-17T17:00:00.000Z');
    const month = dashboardRange('month', '2026-12-12');
    expect(month.to).toBe('2026-12-31T17:00:00.000Z');
    const year = dashboardRange('year', '2026-05-12');
    expect(year.from).toBe('2025-12-31T17:00:00.000Z');
    expect(year.to).toBe('2026-12-31T17:00:00.000Z');
  });

  it('rejects invalid or impossible report periods and dates', () => {
    expect(() => dashboardRange('week', '2026-10-17')).toThrow(BadRequestException);
    expect(() => dashboardRange('month', '2026-02-31')).toThrow(BadRequestException);
    expect(() => dashboardRange('day', '2026-10-32')).toThrow(BadRequestException);
  });

  it('requires both customer and staff management before any report query', async () => {
    const query = jest.fn();
    const service = new AdminDashboardService({ query } as unknown as DataSource);
    await expect(
      service.overview({ ...actor, permissions: ['staff.manage'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('coalesces concurrent requests and caches the five bounded aggregate queries', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('COUNT(*)::int requests')) {
        return Promise.resolve([
          {
            requests: 2,
            pending: 1,
            contacted: 0,
            confirmed: 0,
            inService: 0,
            completed: 1,
            cancelled: 0,
          },
        ]);
      }
      if (sql.includes('FROM services WHERE is_published')) return Promise.resolve([{ total: 8 }]);
      return Promise.resolve([]);
    });
    const service = new AdminDashboardService({ query } as unknown as DataSource);
    const [first, second] = await Promise.all([
      service.overview(actor, 'month', '2026-10-17'),
      service.overview(actor, 'month', '2026-10-17'),
    ]);
    const third = await service.overview(actor, 'month', '2026-10-17');
    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(first.totals.requests).toBe(2);
    expect(first.serviceCount).toBe(8);
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls.some(([sql]) => sql.includes('LEFT JOIN appointments'))).toBe(true);
  });
});
