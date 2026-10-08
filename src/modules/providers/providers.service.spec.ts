import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ProvidersService } from './providers.service';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { StaffProfile } from '../identity/entities/staff-profile.entity';

describe('Provider eligibility', () => {
  const applications = {
    findOneBy: jest.fn(),
    find: jest.fn(),
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: unknown) => Promise.resolve(input)),
  };
  const certificates = { find: jest.fn() };
  const profiles = { findOneBy: jest.fn() };
  const service = new ProvidersService(
    applications as unknown as Repository<ProviderApplication>,
    certificates as unknown as Repository<ProviderCertificate>,
    profiles as unknown as Repository<StaffProfile>,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does not grant approval at initial application', async () => {
    applications.findOneBy.mockResolvedValue(null);
    const applied = await service.apply('user-1', { publicName: 'Lan' });
    expect(applied.status).toBe('APPLIED');
    expect(applications.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a second provider application', async () => {
    applications.findOneBy.mockResolvedValue({ id: 'existing' });
    await expect(service.apply('user-1', { publicName: 'Lan' })).rejects.toThrow(ConflictException);
  });

  it('rejects approving a provider without active certificate', async () => {
    applications.findOneBy.mockResolvedValue({ id: 'application-1', userId: 'applicant' });
    certificates.find.mockResolvedValue([]);
    await expect(
      service.review('application-1', 'manager', { status: 'APPROVED' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not allow self-review', async () => {
    applications.findOneBy.mockResolvedValue({ id: 'application-1', userId: 'applicant' });
    await expect(
      service.review('application-1', 'applicant', { status: 'APPROVED' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not expose expired, suspended or unlisted providers', async () => {
    applications.find.mockResolvedValue([
      { id: 'app-1', userId: 'u1', publicName: 'A', status: 'APPROVED' },
      { id: 'app-2', userId: 'u2', publicName: 'B', status: 'APPROVED' },
    ]);
    profiles.findOneBy
      .mockResolvedValueOnce({ avatarUrl: null, isActive: true, isPublic: true })
      .mockResolvedValueOnce(null);
    certificates.find.mockResolvedValue([
      { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    ]);
    expect(await service.publicProviders()).toEqual([]);
  });
});
