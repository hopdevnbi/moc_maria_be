import type { DataSource, Repository } from 'typeorm';
import type { User } from '../identity/entities/user.entity';
import { ProfilesService } from './profiles.service';

describe('Customer profile membership (self only)', () => {
  const customer = {
    id: 'customer-id',
    displayName: 'Khách VIP',
    email: 'customer@example.invalid',
    phone: null,
    customer: {
      id: 'profile-id',
      avatarUrl: 'https://cdn.example.invalid/avatar.webp',
      birthday: null,
      contactPreferences: {},
    },
    userRoles: [{ role: { name: 'CUSTOMER' } }],
  };

  const create = (record: object | null): { query: jest.Mock; service: ProfilesService } => {
    const query = jest.fn().mockResolvedValue(record ? [record] : []);
    const users = { findOne: jest.fn().mockResolvedValue(customer) };
    const service = new ProfilesService(
      { query } as unknown as DataSource,
      users as unknown as Repository<User>,
      {} as never,
    );
    return { query, service };
  };

  it('shows VIP only for a real membership that is still valid', async () => {
    const { service, query } = create({
      isVip: true,
      expiresAt: '2099-01-01T00:00:00Z',
      startedAt: '2026-10-10T00:00:00Z',
    });
    const result = (await service.getCustomer('customer-id')) as {
      membership: { tier: string };
      customer: { avatarUrl: string };
    };
    expect(result.membership.tier).toBe('VIP');
    expect(result.customer.avatarUrl).toContain('cdn.example.invalid');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM app_metadata'), [
      'mocmaria.customer.vip.customer-id',
    ]);
  });

  it('never shows expired or revoked membership as VIP', async () => {
    for (const record of [
      { isVip: true, expiresAt: '2020-01-01T00:00:00Z', startedAt: null },
      { isVip: false, expiresAt: null, startedAt: null },
    ]) {
      const { service } = create(record);
      const result = (await service.getCustomer('customer-id')) as {
        membership: { tier: string; expiresAt: string | null };
      };
      expect(result.membership).toMatchObject({ tier: 'STANDARD', expiresAt: null });
    }
  });
});
