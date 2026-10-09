import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { Role } from '../identity/entities/role.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { User } from '../identity/entities/user.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import {
  ApplyProviderDto,
  ReviewProviderDto,
  UpdateOwnApplicationDto,
} from './dto/provider-application.dto';
import { IssueCertificateDto } from './dto/certificate.dto';
import { writeEvidenceCertificate } from './certificate-evidence';
import { currentCertificateEvidence, currentEnrollmentEvidence } from './training-evidence';
import { CertificateIssuance } from './entities/certificate-issuance.entity';
import { ProviderTrustService } from './provider-trust.service';
import { ProviderEligibilityService } from './provider-eligibility.service';
import type { EligibleProviderService } from './provider-eligibility.service';

export interface PublicProviderCard {
  id: string;
  publicName: string;
  introduction: string | null;
  serviceArea: string | null;
  avatarUrl: string | null;
  slug: string;
  title: string;
  yearsExperience: number | null;
  providerKind: string;
  eligibleServices: EligibleProviderService[];
  trainingBadge: 'MOC_MARIA_INTERNAL';
  bookable: false;
}

@Injectable()
export class ProvidersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trust: ProviderTrustService,
    private readonly eligibility: ProviderEligibilityService,
    @InjectRepository(ProviderApplication)
    private readonly applications: Repository<ProviderApplication>,
    @InjectRepository(ProviderCertificate)
    private readonly certificates: Repository<ProviderCertificate>,
    @InjectRepository(StaffProfile) private readonly profiles: Repository<StaffProfile>,
    @InjectRepository(TrainingCourse) private readonly courses: Repository<TrainingCourse>,
    @InjectRepository(TrainingEnrollment)
    private readonly enrollments: Repository<TrainingEnrollment>,
  ) {}

  async apply(userId: string, dto: ApplyProviderDto): Promise<ProviderApplication> {
    if (await this.applications.findOneBy({ userId }))
      throw new ConflictException('Đã có hồ sơ ứng tuyển KTV.');
    try {
      const record = this.applications.create({
        userId,
        publicName: dto.publicName.trim(),
        introduction: dto.introduction?.trim() ?? null,
        serviceArea: dto.serviceArea?.trim() ?? null,
        status: 'APPLIED',
      });
      if (dto.applicationConsentVersion)
        return await this.dataSource.transaction(async (manager) => {
          const application = await manager.save(ProviderApplication, record);
          await this.trust.recordConsent(manager, application, {
            scope: 'APPLICATION_REVIEW',
            version: dto.applicationConsentVersion!,
            granted: true,
          });
          return application;
        });
      return await this.applications.save(record);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new ConflictException('Đã có hồ sơ ứng tuyển KTV.');
      throw error;
    }
  }

  myApplication(userId: string): Promise<ProviderApplication | null> {
    return this.applications.findOneBy({ userId });
  }

  async updateMyApplication(
    userId: string,
    dto: UpdateOwnApplicationDto,
  ): Promise<ProviderApplication> {
    return this.dataSource.transaction(async (manager) => {
      const application = await manager.findOne(ProviderApplication, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!application) throw new NotFoundException('Bạn chưa có hồ sơ ứng tuyển.');
      if (application.status === 'APPROVED')
        throw new BadRequestException('Hồ sơ đã duyệt cần được Mộc xem xét trước khi thay đổi.');
      if (dto.publicName.trim().length < 2 || !dto.introduction.trim() || !dto.serviceArea.trim())
        throw new BadRequestException('Cần tên, giới thiệu kinh nghiệm và khu vực phục vụ hợp lệ.');
      application.publicName = dto.publicName.trim();
      application.introduction = dto.introduction.trim();
      application.serviceArea = dto.serviceArea.trim();
      const saved = await manager.save(application);
      await manager.save(AuditLog, {
        event: 'provider.application.updated',
        actorUserId: userId,
        targetUserId: userId,
        metadata: { applicationId: application.id },
      });
      return saved;
    });
  }

  async myTraining(userId: string): Promise<{
    enrollments: Array<{
      enrollment: Omit<TrainingEnrollment, 'assessedBy'> & {
        evidenceCurrent: boolean;
        currentAttendancePercent: number;
      };
      course: TrainingCourse | null;
    }>;
    certificates: Array<Omit<ProviderCertificate, 'issuedBy'> & { isValid: boolean }>;
  }> {
    const application = await this.applications.findOneBy({ userId });
    if (!application) return { enrollments: [], certificates: [] };
    const [enrollments, certificates] = await Promise.all([
      this.enrollments.find({ where: { providerApplicationId: application.id } }),
      this.certificates.find({ where: { providerApplicationId: application.id } }),
    ]);
    const courses = enrollments.length
      ? await this.courses.find({ where: { id: In(enrollments.map((item) => item.courseId)) } })
      : [];
    const validCertificates = await currentCertificateEvidence(
      this.dataSource.manager,
      certificates,
    );
    const enrollmentEvidence = await currentEnrollmentEvidence(
      this.dataSource.manager,
      enrollments,
    );
    return {
      enrollments: enrollments.map(({ assessedBy: _assessedBy, ...enrollment }) => ({
        enrollment: { ...enrollment, ...enrollmentEvidence.get(enrollment.id)! },
        course: courses.find((item) => item.id === enrollment.courseId) ?? null,
      })),
      certificates: certificates.map(({ issuedBy: _issuedBy, ...certificate }) => ({
        ...certificate,
        isValid: validCertificates.has(certificate.id),
      })),
    };
  }

  async publicProvider(
    id: string,
  ): Promise<Awaited<ReturnType<ProvidersService['publicProviders']>>[number]> {
    const provider = (await this.publicProviders()).find((item) => item.id === id);
    if (!provider) throw new NotFoundException('Không tìm thấy chuyên viên công khai.');
    return provider;
  }

  listApplications(): Promise<ProviderApplication[]> {
    return this.applications.find({ order: { createdAt: 'DESC' } });
  }

  async applicationTraining(id: string): ReturnType<ProvidersService['myTraining']> {
    const application = await this.applications.findOneBy({ id });
    if (!application) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    return this.myTraining(application.userId);
  }

  async issueCertificate(
    applicationId: string,
    actorId: string,
    dto: IssueCertificateDto,
  ): Promise<ProviderCertificate> {
    const applicant = await this.applications.findOneBy({ id: applicationId });
    if (!applicant) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    if (applicant.userId === actorId)
      throw new BadRequestException('Không được tự cấp chứng nhận.');
    if (!['TRAINING', 'ASSESSMENT', 'APPROVED'].includes(applicant.status)) {
      throw new BadRequestException('KTV chưa đủ điều kiện nhận chứng nhận.');
    }
    const course = await this.courses.findOneBy({ code: dto.courseCode, isActive: true });
    if (!course) throw new NotFoundException('Không tìm thấy khóa học Mộc Maria.');
    const training = await this.enrollments.findOneBy({
      courseId: course.id,
      providerApplicationId: applicationId,
    });
    if (
      !training ||
      training.status !== 'COMPLETED' ||
      !training.assessmentPassed ||
      training.attendancePercent < 80
    ) {
      throw new BadRequestException('KTV chưa hoàn thành và đạt đánh giá khóa đào tạo.');
    }
    const issuedAt = new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= issuedAt)
      throw new BadRequestException('Ngày hết hạn không hợp lệ.');
    return this.dataSource.transaction(async (manager) => {
      // Serialize eligibility changes, certificate issue/revoke and future booking acceptance.
      const current = await manager.findOneOrFail(ProviderApplication, {
        where: { id: applicationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!['TRAINING', 'ASSESSMENT', 'APPROVED'].includes(current.status))
        throw new BadRequestException('Hồ sơ đã thay đổi trạng thái.');
      const latestTraining = await manager.findOneBy(TrainingEnrollment, {
        courseId: course.id,
        providerApplicationId: applicationId,
      });
      if (
        !latestTraining ||
        latestTraining.status !== 'COMPLETED' ||
        !latestTraining.assessmentPassed ||
        latestTraining.attendancePercent < 80
      )
        throw new BadRequestException('KTV chưa đạt đánh giá khóa đào tạo.');
      return writeEvidenceCertificate(manager, current, actorId, dto);
    });
  }

  async renewCertificate(
    applicationId: string,
    certificateId: string,
    actorId: string,
    dto: IssueCertificateDto,
  ): Promise<ProviderCertificate> {
    return this.dataSource.transaction(async (manager) => {
      const app = await manager.findOne(ProviderApplication, {
        where: { id: applicationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!app) throw new NotFoundException('Không tìm thấy hồ sơ.');
      return writeEvidenceCertificate(manager, app, actorId, dto, certificateId);
    });
  }

  async certificateHistory(
    applicationId: string,
    certificateId: string,
  ): Promise<CertificateIssuance[]> {
    const cert = await this.certificates.findOneBy({
      id: certificateId,
      providerApplicationId: applicationId,
    });
    if (!cert) throw new NotFoundException('Không tìm thấy chứng nhận của hồ sơ.');
    return this.dataSource.manager.find(CertificateIssuance, {
      where: { certificateId },
      order: { issuedAt: 'ASC', id: 'ASC' },
    });
  }

  async revokeCertificate(
    applicationId: string,
    certificateId: string,
    actorId: string,
  ): Promise<ProviderCertificate> {
    return this.dataSource.transaction(async (manager) => {
      const application = await manager.findOne(ProviderApplication, {
        where: { id: applicationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!application) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
      if (application.userId === actorId)
        throw new BadRequestException('Không được tự xử lý chứng nhận.');
      const cert = await manager.findOneBy(ProviderCertificate, {
        id: certificateId,
        providerApplicationId: applicationId,
      });
      if (!cert) throw new NotFoundException('Không tìm thấy chứng nhận.');
      if (!cert.revokedAt) cert.revokedAt = new Date();
      const saved = await manager.save(cert);
      if (application.status === 'APPROVED') {
        application.status = 'SUSPENDED';
        await manager.save(application);
      }
      await manager.save(AuditLog, {
        event: 'provider.certificate.revoked',
        actorUserId: actorId,
        targetUserId: application.userId,
        metadata: { applicationId, certificateId },
      });
      return saved;
    });
  }

  async review(id: string, actorId: string, dto: ReviewProviderDto): Promise<ProviderApplication> {
    return this.dataSource.transaction(async (manager) => {
      const app = await manager.findOne(ProviderApplication, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!app) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
      if (actorId === app.userId) throw new BadRequestException('Không được tự duyệt hồ sơ.');
      if (!dto.note?.trim()) throw new BadRequestException('Cần ghi rõ lý do/phản hồi quyết định.');
      const transitions: Record<string, string[]> = {
        APPLIED: ['REVIEWING', 'REJECTED'],
        REVIEWING: ['TRAINING', 'REJECTED'],
        TRAINING: ['ASSESSMENT', 'REJECTED'],
        ASSESSMENT: ['TRAINING', 'APPROVED', 'REJECTED'],
        APPROVED: ['SUSPENDED'],
        REJECTED: ['REVIEWING'],
        SUSPENDED: ['TRAINING', 'ASSESSMENT', 'APPROVED', 'REJECTED'],
      };
      if (!transitions[app.status]?.includes(dto.status))
        throw new BadRequestException('Chuyển trạng thái hồ sơ không hợp lệ.');
      const previousStatus = app.status;
      if (dto.status === 'APPROVED') {
        const certs = await manager.find(ProviderCertificate, {
          where: { providerApplicationId: id },
        });
        const now = Date.now();
        if (!(await currentCertificateEvidence(manager, certs, new Date(now))).size) {
          throw new BadRequestException('KTV chưa có chứng nhận đào tạo nội bộ hợp lệ.');
        }
        await this.trust.assertApprovalReady(id, manager);
        if (!(await manager.findOneBy(User, { id: app.userId, isActive: true })))
          throw new BadRequestException('Tài khoản KTV không hoạt động.');
        const role = await manager.findOneByOrFail(Role, { name: 'THERAPIST' });
        if (!(await manager.findOneBy(UserRole, { userId: app.userId, roleId: role.id })))
          await manager.save(UserRole, { userId: app.userId, roleId: role.id });
        if (!(await manager.findOneBy(StaffProfile, { userId: app.userId })))
          await manager.save(StaffProfile, {
            userId: app.userId,
            publicName: app.publicName,
            bio: app.introduction,
            isActive: true,
            isPublic: false,
            avatarUrl: null,
          });
      }
      app.status = dto.status;
      app.reviewedBy = actorId;
      app.reviewNote = dto.note?.trim() ?? null;
      const saved = await manager.save(app);
      await manager.save(AuditLog, {
        event: 'provider.application.reviewed',
        actorUserId: actorId,
        targetUserId: app.userId,
        metadata: { applicationId: id, previousStatus, status: dto.status },
      });
      return saved;
    });
  }

  async publicProviders(): Promise<PublicProviderCard[]> {
    const approved = await this.applications.find({ where: { status: 'APPROVED' } });
    if (!approved.length) return [];
    const [profiles, certs, users, readiness] = await Promise.all([
      this.profiles.find({
        where: { userId: In(approved.map((app) => app.userId)), isActive: true, isPublic: true },
      }),
      this.certificates.find({
        where: { providerApplicationId: In(approved.map((app) => app.id)) },
      }),
      this.dataSource.getRepository(User).find({
        select: ['id', 'email', 'phone', 'isActive'],
        where: { id: In(approved.map((app) => app.userId)), isActive: true },
      }),
      this.eligibility.readinessBatch(approved.map((app) => app.id)),
    ]);
    const trustedIds = await this.trust.publicEligibleIds(approved, users);
    const result: PublicProviderCard[] = [];
    for (const app of approved) {
      if (!trustedIds.has(app.id)) continue;
      const ready = readiness.get(app.id);
      if (!ready?.serviceReady || !ready.profile || !ready.providerKind) continue;
      const profile = profiles.find((profile) => profile.userId === app.userId);
      if (!profile || !users.some((user) => user.id === app.userId)) continue;
      if (
        !certs.some(
          (c) =>
            c.providerApplicationId === app.id &&
            !c.revokedAt &&
            (!c.expiresAt || c.expiresAt.getTime() > Date.now()),
        )
      )
        continue;
      result.push({
        id: app.id,
        publicName: app.publicName,
        introduction: app.introduction,
        serviceArea: app.serviceArea,
        // Public text consent does not authorize publishing personal photos.
        avatarUrl: null,
        slug: ready.profile.slug,
        title: ready.profile.title,
        yearsExperience: ready.profile.yearsExperience,
        providerKind: ready.providerKind,
        eligibleServices: ready.services,
        trainingBadge: 'MOC_MARIA_INTERNAL',
        bookable: false,
      });
    }
    return result;
  }
}
