import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrainingService } from './training.service';
import { ProviderApplication } from './entities/provider-application.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';

describe('Training eligibility', () => {
  const applications = { findOneBy: jest.fn() };
  const courses = { findOneBy: jest.fn() };
  const enrollments = {
    findOneBy: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };
  const manager = {
    findOneOrFail: jest.fn(),
    save: jest.fn((...args: unknown[]) => Promise.resolve(args[args.length - 1])),
  };
  const dataSource = {
    transaction: jest.fn((callback: (m: typeof manager) => unknown) => callback(manager)),
  };
  const service = new TrainingService(
    dataSource as unknown as DataSource,
    applications as unknown as Repository<ProviderApplication>,
    courses as unknown as Repository<TrainingCourse>,
    enrollments as unknown as Repository<TrainingEnrollment>,
  );

  beforeEach(() => jest.clearAllMocks());

  it('blocks enrollment if provider not under review or training', async () => {
    applications.findOneBy.mockResolvedValue({ status: 'REJECTED' });
    await expect(
      service.enroll({
        providerApplicationId: 'app',
        courseId: 'course',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not permit duplicate enrollment', async () => {
    applications.findOneBy.mockResolvedValue({ status: 'TRAINING' });
    courses.findOneBy.mockResolvedValue({ id: 'course' });
    enrollments.findOneBy.mockResolvedValue({ id: 'existing' });
    await expect(
      service.enroll({ providerApplicationId: 'app', courseId: 'course' }),
    ).rejects.toThrow(ConflictException);
  });

  it('prevents provider self-assessment', async () => {
    enrollments.findOneBy.mockResolvedValue({ providerApplicationId: 'app' });
    applications.findOneBy.mockResolvedValue({ userId: 'same-user' });
    await expect(
      service.assess('enrollment', 'same-user', {
        attendancePercent: 100,
        assessmentPassed: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not pass practical assessment below 80 percent attendance', async () => {
    enrollments.findOneBy.mockResolvedValue({ providerApplicationId: 'app' });
    applications.findOneBy.mockResolvedValue({ userId: 'trainee' });
    manager.findOneOrFail
      .mockResolvedValueOnce({ id: 'app', status: 'ASSESSMENT' })
      .mockResolvedValueOnce({ id: 'enrollment', providerApplicationId: 'app' });
    const result = await service.assess('enrollment', 'assessor', {
      attendancePercent: 60,
      assessmentPassed: true,
    });
    expect(result.assessmentPassed).toBe(false);
    expect(result.status).toBe('FAILED');
  });
});
