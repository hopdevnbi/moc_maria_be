import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderDisplayService } from './provider-display.service';
import { ReorderProviderDisplayDto, UpdateProviderDisplayDto } from './provider-display.dto';

describe('Provider display input and access', () => {
  it('only allows Super Admin to assign a profile avatar from uploaded media', async () => {
    const id = 'ea565a39-32d8-42ac-8aa0-4273b686dc7d';
    const mediaId = 'd90b3545-d828-450e-8782-20a9207accaa';
    const transaction = jest.fn();
    const service = new ProviderDisplayService({ transaction } as unknown as DataSource);
    await expect(
      service.setAvatarFromShowcase(
        { roles: ['ADMIN'], permissions: ['staff.manage'] } as AuthUserContext,
        id,
        mediaId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();

    const original = process.env['BUNNY_STORAGE_CDN_URL'];
    process.env['BUNNY_STORAGE_CDN_URL'] = 'https://giangxa-media-cdn.b-cdn.net';
    const query = jest.fn().mockResolvedValue([]);
    const withDb = new ProviderDisplayService({
      transaction: jest.fn(async (callback: (m: { query: typeof query }) => Promise<unknown>) =>
        callback({ query }),
      ),
    } as unknown as DataSource);
    try {
      await expect(
        withDb.setAvatarFromShowcase(
          { roles: ['SUPER_ADMIN'], permissions: ['staff.manage'] } as AuthUserContext,
          id,
          mediaId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) delete process.env['BUNNY_STORAGE_CDN_URL'];
      else process.env['BUNNY_STORAGE_CDN_URL'] = original;
    }
  });
  it('refuses non-administrators before touching the database', async () => {
    const transaction = jest.fn();
    const service = new ProviderDisplayService({ transaction } as unknown as DataSource);
    await expect(
      service.list({ roles: ['THERAPIST'], permissions: ['staff.manage'] } as AuthUserContext),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.list({ roles: ['ADMIN'], permissions: [] } as unknown as AuthUserContext),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects duplicate identities, invalid positions and malformed profile values', async () => {
    const id = 'ea565a39-32d8-42ac-8aa0-4273b686dc7d';
    expect(
      await validate(
        plainToInstance(ReorderProviderDisplayDto, { expectedVersion: 0, providerIds: [id, id] }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateProviderDisplayDto, {
          expectedVersion: -1,
          age: 17,
          yearsExperience: 1.5,
          publicName: ' ',
          visibility: 'DELETED',
        }),
      ),
    ).toHaveLength(5);
  });
  it('permits clearing optional age while retaining full Unicode names', async () => {
    const dto = plainToInstance(UpdateProviderDisplayDto, {
      expectedVersion: 4,
      publicName: '  Nguyễn Ánh  ',
      age: null,
      yearsExperience: 0,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.publicName).toBe('Nguyễn Ánh');
  });
});
