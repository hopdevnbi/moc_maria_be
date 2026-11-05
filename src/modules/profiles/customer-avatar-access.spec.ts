import { ForbiddenException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { User } from '../identity/entities/user.entity';
import { ProfilesService } from './profiles.service';

describe('customer avatar permission', () => {
  it('permits active standard customers with a profile (no VIP requirement)', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'customer-a' }]);
    const service = new ProfilesService(
      { query } as unknown as DataSource,
      {} as Repository<User>,
      {} as never,
    );
    await expect(service.assertCustomerAvatarAccess('customer-a')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('JOIN customers c'), ['customer-a']);
    const statement = (query.mock.calls as Array<[string]>)[0]?.[0] ?? '';
    expect(statement).not.toContain('isVip');
  });

  it('rejects inactive or missing customer accounts', async () => {
    const service = new ProfilesService(
      { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource,
      {} as Repository<User>,
      {} as never,
    );
    await expect(service.assertCustomerAvatarAccess('disabled')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
