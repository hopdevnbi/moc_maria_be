import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ProvidersService } from './providers.service';
import { ProviderTrustService } from './provider-trust.service';
import { ProviderEligibilityService } from './provider-eligibility.service';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';

describe('Provider eligibility', () => {
  const applications = {
    findOneBy: jest.fn(),
    find: jest.fn(),
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: unknown) => Promise.resolve(input)),
  };
  const certificates = { find: jest.fn() };
  const profiles = { find: jest.fn() };
  const users = { find: jest.fn() };
  const manager = { findOne: jest.fn(), find: jest.fn() };
  const dataSource = {
    transaction: jest.fn((callback: (m: typeof manager) => unknown) => callback(manager)),
    getRepository: jest.fn(() => users),
  };
  const courses = { findOneBy: jest.fn() };
  const enrollments = { findOneBy: jest.fn() };
  const trust = {
    assertApprovalReady: jest.fn(),
    publicEligibleIds: jest.fn(() => Promise.resolve(new Set<string>())),
  };
  const service = new ProvidersService(
    dataSource as unknown as DataSource,
    trust as unknown as ProviderTrustService,
    {
      readinessBatch: jest.fn(() => Promise.resolve(new Map())),
    } as unknown as ProviderEligibilityService,
    applications as unknown as Repository<ProviderApplication>,
    certificates as unknown as Repository<ProviderCertificate>,
    profiles as unknown as Repository<StaffProfile>,
    courses as unknown as Repository<TrainingCourse>,
    enrollments as unknown as Repository<TrainingEnrollment>,
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
    manager.findOne.mockResolvedValue({
      id: 'application-1',
      userId: 'applicant',
      status: 'ASSESSMENT',
    });
    manager.find.mockResolvedValue([]);
    await expect(
      service.review('application-1', 'manager', { status: 'APPROVED', note: 'QA decision' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects issuing a certificate before a real completed course', async () => {
    applications.findOneBy.mockResolvedValue({
      id: 'app',
      userId: 'trainee',
      status: 'ASSESSMENT',
    });
    courses.findOneBy.mockResolvedValue({ id: 'course', title: 'Massage training' });
    enrollments.findOneBy.mockResolvedValue({
      status: 'IN_PROGRESS',
      attendancePercent: 100,
      assessmentPassed: false,
    });
    await expect(
      service.issueCertificate('app', 'admin', {
        courseCode: 'TRAIN01',
        title: 'Massage training',
        certificateNumber: 'CERT-001',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not allow self-review', async () => {
    manager.findOne.mockResolvedValue({
      id: 'application-1',
      userId: 'applicant',
      status: 'ASSESSMENT',
    });
    await expect(
      service.review('application-1', 'applicant', { status: 'APPROVED', note: 'QA decision' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not expose expired, suspended or unlisted providers', async () => {
    applications.find.mockResolvedValue([
      { id: 'app-1', userId: 'u1', publicName: 'A', status: 'APPROVED' },
      { id: 'app-2', userId: 'u2', publicName: 'B', status: 'APPROVED' },
    ]);
    profiles.find.mockResolvedValue([
      { userId: 'u1', avatarUrl: null, isActive: true, isPublic: true },
    ]);
    users.find.mockResolvedValue([{ id: 'u1' }]);
    certificates.find.mockResolvedValue([
      { providerApplicationId: 'app-1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    ]);
    expect(await service.publicProviders()).toEqual([]);
  });

  it('returns the real staff avatar only within the protected admin directory', async () => {
    applications.find.mockResolvedValue([
      { id: 'app-1', userId: 'user-1', publicName: 'Linh Anh', status: 'APPLIED' },
      { id: 'app-2', userId: 'user-2', publicName: 'Mai Anh', status: 'REVIEWING' },
    ]);
    profiles.find.mockResolvedValue([
      { userId: 'user-1', avatarUrl: 'https://cdn.example.com/avatar.webp' },
    ]);
    expect(await service.listApplications()).toEqual([
      expect.objectContaining({ id: 'app-1', avatarUrl: 'https://cdn.example.com/avatar.webp' }),
      expect.objectContaining({ id: 'app-2', avatarUrl: null }),
    ]);
    expect(profiles.find).toHaveBeenCalledTimes(1);
  });

  it('does not query profiles when there are no applications', async () => {
    applications.find.mockResolvedValue([]);
    expect(await service.listApplications()).toEqual([]);
    expect(profiles.find).not.toHaveBeenCalled();
  });
});
