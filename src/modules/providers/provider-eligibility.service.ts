import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { Branch } from '../catalog/entities/branch.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceVariant } from '../catalog/entities/service-variant.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { BranchService } from '../catalog/entities/branch-service.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { ProviderSkill } from './entities/provider-skill.entity';
import { ProviderBranchAssignment } from './entities/provider-branch-assignment.entity';
import { ProviderWeeklyShift } from './entities/provider-weekly-shift.entity';
import { ProviderDateSchedule } from './entities/provider-date-schedule.entity';
import { ProviderPublicProfile } from './entities/provider-public-profile.entity';
import { ProviderOperatingReview } from './entities/provider-operating-review.entity';
import { ServiceProviderPolicy } from './entities/service-provider-policy.entity';
import { ProviderServiceGrant } from './entities/provider-service-grant.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import { currentCertificateEvidence } from './training-evidence';
import { TrainingCriterion } from './entities/training-criterion.entity';
import { ProviderTrustService } from './provider-trust.service';
import {
  SaveProviderOperatingReviewDto,
  SaveProviderPublicProfileDto,
  SaveProviderServiceGrantDto,
  SaveServiceProviderPolicyDto,
} from './dto/provider-eligibility.dto';

export interface EligibleProviderService {
  serviceId: string;
  serviceName: string;
  branchId: string;
  branchName: string;
  policyId: string;
  mode: 'ON_SITE' | 'AT_HOME';
  jurisdictionCode: string;
  territoryLabel: string;
  travelBufferMinutes: number;
  travelFeeVnd: string;
  maxRadiusKm: number | null;
}
export interface ProviderServiceReadiness {
  applicationId: string;
  profile: { slug: string; title: string; yearsExperience: number | null } | null;
  providerKind: string | null;
  qualityStatus: string | null;
  services: EligibleProviderService[];
  blockers: string[];
  serviceReady: boolean;
  bookable: false;
}

@Injectable()
export class ProviderEligibilityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trust: ProviderTrustService,
  ) {}

  private future(value: string): Date {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
      throw new BadRequestException('Ngày hết hiệu lực phải ở tương lai.');
    return date;
  }
  private async lock(
    manager: EntityManager,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<ProviderApplication> {
    const app = await manager.findOne(ProviderApplication, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!app) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    if (app.userId === actorId)
      throw new BadRequestException('Không được tự xác nhận điều kiện phục vụ của mình.');
    if (reason.trim().length < 3) throw new BadRequestException('Cần lý do thay đổi rõ ràng.');
    return app;
  }
  private audit(
    manager: EntityManager,
    actorId: string,
    event: string,
    reason: string,
    metadata: Record<string, unknown>,
    targetUserId: string | null = null,
  ): Promise<AuditLog> {
    return manager.save(AuditLog, {
      actorUserId: actorId,
      targetUserId,
      event,
      metadata: { ...metadata, reason: reason.trim() },
    });
  }

  async savePublicProfile(
    id: string,
    actorId: string,
    dto: SaveProviderPublicProfileDto,
  ): Promise<ProviderPublicProfile> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const app = await this.lock(manager, id, actorId, dto.reason);
        if (!dto.title.trim())
          throw new BadRequestException('Cần chức danh công khai đã kiểm tra.');
        if (dto.isPublished) {
          if (app.status !== 'APPROVED')
            throw new BadRequestException('Hồ sơ chưa được phê duyệt.');
          await this.trust.assertApprovalReady(id, manager);
          if (!(await this.trust.summary(id, manager)).publicConsent)
            throw new BadRequestException('KTV chưa đồng ý công khai hồ sơ.');
        }
        await manager.upsert(
          ProviderPublicProfile,
          {
            providerApplicationId: id,
            slug: dto.slug,
            title: dto.title.trim(),
            yearsExperience: dto.yearsExperience ?? null,
            isPublished: dto.isPublished,
            reviewedBy: actorId,
            reviewedAt: new Date(),
          },
          ['providerApplicationId'],
        );
        await manager.update(StaffProfile, { userId: app.userId }, { isPublic: dto.isPublished });
        const saved = await manager.findOneByOrFail(ProviderPublicProfile, {
          providerApplicationId: id,
        });
        await this.audit(
          manager,
          actorId,
          'provider.public_profile.reviewed',
          dto.reason,
          { applicationId: id, isPublished: dto.isPublished },
          app.userId,
        );
        return saved;
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505')
        throw new ConflictException('Đường dẫn hồ sơ đã được sử dụng.');
      throw error;
    }
  }

  async saveOperatingReview(
    id: string,
    actorId: string,
    dto: SaveProviderOperatingReviewDto,
  ): Promise<ProviderOperatingReview> {
    return this.dataSource.transaction(async (manager) => {
      const app = await this.lock(manager, id, actorId, dto.reason);
      if (dto.qualityStatus === 'ACTIVE') {
        if (app.status !== 'APPROVED')
          throw new BadRequestException('Chỉ đánh giá hoạt động cho hồ sơ đã được duyệt.');
        await this.trust.assertApprovalReady(id, manager);
      }
      await manager.upsert(
        ProviderOperatingReview,
        {
          providerApplicationId: id,
          providerKind: dto.providerKind,
          qualityStatus: dto.qualityStatus,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
        ['providerApplicationId'],
      );
      await this.audit(
        manager,
        actorId,
        'provider.operating_review.saved',
        dto.reason,
        { applicationId: id, qualityStatus: dto.qualityStatus, providerKind: dto.providerKind },
        app.userId,
      );
      return manager.findOneByOrFail(ProviderOperatingReview, { providerApplicationId: id });
    });
  }

  policies(): Promise<ServiceProviderPolicy[]> {
    return this.dataSource.manager.find(ServiceProviderPolicy);
  }
  async configuration(id: string): Promise<{
    profile: ProviderPublicProfile | null;
    review: ProviderOperatingReview | null;
    grants: ProviderServiceGrant[];
  }> {
    const manager = this.dataSource.manager;
    if (!(await manager.findOneBy(ProviderApplication, { id })))
      throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    const [profile, review, grants] = await Promise.all([
      manager.findOneBy(ProviderPublicProfile, { providerApplicationId: id }),
      manager.findOneBy(ProviderOperatingReview, { providerApplicationId: id }),
      manager.find(ProviderServiceGrant, { where: { providerApplicationId: id } }),
    ]);
    return { profile, review, grants };
  }
  async savePolicy(
    actorId: string,
    dto: SaveServiceProviderPolicyDto,
  ): Promise<ServiceProviderPolicy> {
    if (dto.reason.trim().length < 3)
      throw new BadRequestException('Cần lý do rà soát chính sách.');
    const validUntil = dto.isActive ? this.future(dto.validUntil) : new Date(dto.validUntil);
    return this.dataSource.transaction(async (manager) => {
      if (
        !(await manager.findOneBy(Service, { id: dto.serviceId })) ||
        !(await manager.findOneBy(Branch, { id: dto.branchId })) ||
        !(await manager.findOneBy(TrainingCourse, { id: dto.courseId }))
      )
        throw new NotFoundException('Dịch vụ, cơ sở hoặc khóa đào tạo không tồn tại.');
      await manager.upsert(
        ServiceProviderPolicy,
        {
          serviceId: dto.serviceId,
          branchId: dto.branchId,
          courseId: dto.courseId,
          mode: dto.mode,
          jurisdictionCode: dto.jurisdictionCode,
          territoryLabel: dto.territoryLabel.trim(),
          legalRequirement: dto.legalRequirement,
          legalReviewReference: dto.legalReviewReference,
          validUntil,
          isActive: dto.isActive,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
        ['serviceId', 'branchId', 'mode', 'jurisdictionCode'],
      );
      const saved = await manager.findOneByOrFail(ServiceProviderPolicy, {
        serviceId: dto.serviceId,
        branchId: dto.branchId,
        mode: dto.mode,
        jurisdictionCode: dto.jurisdictionCode,
      });
      await this.audit(manager, actorId, 'service.provider_policy.reviewed', dto.reason, {
        policyId: saved.id,
        isActive: dto.isActive,
        legalRequirement: dto.legalRequirement,
      });
      return saved;
    });
  }

  async saveGrant(
    id: string,
    actorId: string,
    dto: SaveProviderServiceGrantDto,
  ): Promise<ProviderServiceGrant> {
    return this.dataSource.transaction(async (manager) => {
      const app = await this.lock(manager, id, actorId, dto.reason);
      const policy = await manager.findOneBy(ServiceProviderPolicy, { id: dto.policyId });
      if (!policy) throw new NotFoundException('Không tìm thấy chính sách dịch vụ/phạm vi.');
      const review = await manager.findOneBy(ProviderOperatingReview, {
        providerApplicationId: id,
      });
      const legalRequired =
        policy.legalRequirement === 'LICENSE_REQUIRED' || review?.providerKind === 'SPECIALIST';
      const expiry = dto.credentialValidUntil
        ? dto.isActive
          ? this.future(dto.credentialValidUntil)
          : new Date(dto.credentialValidUntil)
        : null;
      if (dto.isActive && legalRequired && (!dto.credentialReference || !expiry))
        throw new BadRequestException(
          'Cần biên bản xác minh giấy phép/chứng chỉ chuyên ngành còn hiệu lực.',
        );
      if (
        policy.mode === 'ON_SITE' &&
        (dto.travelFeeVnd || dto.travelBufferMinutes || dto.maxRadiusKm)
      )
        throw new BadRequestException('Phí/buffer/bán kính di chuyển chỉ áp dụng tại nhà.');
      const branch = await manager.findOneByOrFail(Branch, { id: policy.branchId });
      if (
        dto.isActive &&
        dto.maxRadiusKm &&
        (branch.latitude === null || branch.longitude === null)
      )
        throw new BadRequestException('Cần tọa độ cơ sở để giới hạn bán kính.');
      await manager.upsert(
        ProviderServiceGrant,
        {
          providerApplicationId: id,
          policyId: dto.policyId,
          credentialReference: dto.credentialReference ?? null,
          credentialValidUntil: expiry,
          travelBufferMinutes: dto.travelBufferMinutes,
          travelFeeVnd: String(dto.travelFeeVnd),
          maxRadiusKm: dto.maxRadiusKm ?? null,
          isActive: dto.isActive,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
        ['providerApplicationId', 'policyId'],
      );
      const saved = await manager.findOneByOrFail(ProviderServiceGrant, {
        providerApplicationId: id,
        policyId: dto.policyId,
      });
      await this.audit(
        manager,
        actorId,
        'provider.service_grant.reviewed',
        dto.reason,
        { applicationId: id, grantId: saved.id, policyId: dto.policyId, isActive: dto.isActive },
        app.userId,
      );
      return saved;
    });
  }

  async readinessBatch(
    ids: string[],
    manager = this.dataSource.manager,
    at = new Date(),
  ): Promise<Map<string, ProviderServiceReadiness>> {
    if (!ids.length) return new Map();
    const where = { providerApplicationId: In(ids) };
    const [
      applications,
      profiles,
      reviews,
      skills,
      certificates,
      enrollments,
      assignments,
      weekly,
      dated,
      grants,
    ] = await Promise.all([
      manager.find(ProviderApplication, { where: { id: In(ids) } }),
      manager.find(ProviderPublicProfile, { where }),
      manager.find(ProviderOperatingReview, { where }),
      manager.find(ProviderSkill, { where }),
      manager.find(ProviderCertificate, { where }),
      manager.find(TrainingEnrollment, { where }),
      manager.find(ProviderBranchAssignment, { where }),
      manager.find(ProviderWeeklyShift, { where }),
      manager.find(ProviderDateSchedule, { where }),
      manager.find(ProviderServiceGrant, { where }),
    ]);
    const policies = grants.length
      ? await manager.find(ServiceProviderPolicy, {
          where: { id: In(grants.map((g) => g.policyId)) },
        })
      : [];
    const serviceIds = policies.map((p) => p.serviceId),
      branchIds = policies.map((p) => p.branchId);
    const [services, branches, courses, mappings, variants, staffProfiles] = await Promise.all([
      serviceIds.length ? manager.find(Service, { where: { id: In(serviceIds) } }) : [],
      branchIds.length ? manager.find(Branch, { where: { id: In(branchIds) } }) : [],
      policies.length
        ? manager.find(TrainingCourse, { where: { id: In(policies.map((p) => p.courseId)) } })
        : [],
      branchIds.length
        ? manager.find(BranchService, {
            where: { branchId: In(branchIds), serviceId: In(serviceIds) },
          })
        : [],
      serviceIds.length
        ? manager.find(ServiceVariant, { where: { serviceId: In(serviceIds), isActive: true } })
        : [],
      applications.length
        ? manager.find(StaffProfile, { where: { userId: In(applications.map((a) => a.userId)) } })
        : [],
    ]);
    const validCertificates = await currentCertificateEvidence(manager, certificates, at);
    const practicalCriteria = courses.length
      ? await manager.find(TrainingCriterion, {
          where: { courseId: In(courses.map((c) => c.id)), isActive: true, isRequired: true },
        })
      : [];
    const categories = services.length
      ? await manager.find(ServiceCategory, {
          where: { id: In(services.map((s) => s.categoryId)) },
        })
      : [];
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
    return new Map(
      applications.map((app) => {
        const profile = profiles.find((p) => p.providerApplicationId === app.id);
        const review = reviews.find((r) => r.providerApplicationId === app.id);
        const blockers: string[] = [];
        if (app.status !== 'APPROVED') blockers.push('APPLICATION_NOT_APPROVED');
        if (!profile?.isPublished) blockers.push('PUBLIC_PROFILE_NOT_REVIEWED');
        if (!staffProfiles.some((p) => p.userId === app.userId && p.isActive && p.isPublic))
          blockers.push('STAFF_PROFILE_DISABLED');
        if (review?.qualityStatus !== 'ACTIVE') blockers.push('QUALITY_NOT_ACTIVE');
        const eligible: EligibleProviderService[] = [];
        for (const grant of grants.filter(
          (g) => g.providerApplicationId === app.id && g.isActive,
        )) {
          const policy = policies.find((p) => p.id === grant.policyId);
          if (!policy?.isActive || policy.validUntil <= at) continue;
          const service = services.find((s) => s.id === policy.serviceId && s.isPublished);
          const branch = branches.find((b) => b.id === policy.branchId && b.isActive);
          const course = courses.find((c) => c.id === policy.courseId && c.isActive);
          if (
            !service ||
            !branch ||
            !course ||
            !categories.some((c) => c.id === service.categoryId && c.isPublished)
          )
            continue;
          if (!variants.some((v) => v.serviceId === service.id)) continue;
          if (
            !mappings.some(
              (m) => m.branchId === branch.id && m.serviceId === service.id && m.isActive,
            )
          )
            continue;
          if (
            !assignments.some(
              (a) => a.providerApplicationId === app.id && a.branchId === branch.id && a.isActive,
            )
          )
            continue;
          const skill = skills.find(
            (s) => s.providerApplicationId === app.id && s.serviceId === service.id && s.isActive,
          );
          const certificate = certificates.find(
            (c) =>
              c.id === skill?.certificateId &&
              validCertificates.has(c.id) &&
              c.providerApplicationId === app.id &&
              c.courseCode === course.code &&
              !c.revokedAt &&
              (!c.expiresAt || c.expiresAt > at),
          );
          if (
            !certificate ||
            !practicalCriteria.some(
              (c) => c.courseId === course.id && c.serviceId === service.id,
            ) ||
            !enrollments.some(
              (e) =>
                e.providerApplicationId === app.id &&
                e.courseId === course.id &&
                e.status === 'COMPLETED' &&
                e.assessmentPassed &&
                e.attendancePercent >= 80,
            )
          )
            continue;
          if (
            (policy.legalRequirement === 'LICENSE_REQUIRED' ||
              review?.providerKind === 'SPECIALIST') &&
            (!grant.credentialReference ||
              !grant.credentialValidUntil ||
              grant.credentialValidUntil <= at)
          )
            continue;
          if (grant.maxRadiusKm && (branch.latitude === null || branch.longitude === null))
            continue;
          if (
            !weekly.some(
              (s) => s.providerApplicationId === app.id && s.branchId === branch.id && s.isActive,
            ) &&
            !dated.some(
              (s) =>
                s.providerApplicationId === app.id &&
                s.branchId === branch.id &&
                s.kind === 'OVERRIDE' &&
                s.isActive &&
                s.date >= localDate,
            )
          )
            continue;
          eligible.push({
            serviceId: service.id,
            serviceName: service.name,
            branchId: branch.id,
            branchName: branch.name,
            policyId: policy.id,
            mode: policy.mode,
            jurisdictionCode: policy.jurisdictionCode,
            territoryLabel: policy.territoryLabel,
            travelBufferMinutes: grant.travelBufferMinutes,
            travelFeeVnd: grant.travelFeeVnd,
            maxRadiusKm: grant.maxRadiusKm,
          });
        }
        if (!eligible.length)
          blockers.push('NO_VALID_SERVICE_TRAINING_LEGAL_TERRITORY_AND_SCHEDULE');
        return [
          app.id,
          {
            applicationId: app.id,
            profile: profile
              ? {
                  slug: profile.slug,
                  title: profile.title,
                  yearsExperience: profile.yearsExperience,
                }
              : null,
            providerKind: review?.providerKind ?? null,
            qualityStatus: review?.qualityStatus ?? null,
            services: blockers.length ? [] : eligible,
            blockers,
            serviceReady: !blockers.length,
            bookable: false as const,
          },
        ];
      }),
    );
  }

  async summary(id: string): Promise<ProviderServiceReadiness> {
    const readiness = (await this.readinessBatch([id])).get(id);
    if (!readiness) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    const trust = await this.trust.summary(id);
    if (!trust.reviewReady)
      readiness.blockers.push('PROFILE_OR_CURRENT_CONTACT_OR_APPLICATION_CONSENT');
    if (!trust.publicConsent) readiness.blockers.push('PUBLIC_CONSENT_REQUIRED');
    readiness.serviceReady = !readiness.blockers.length;
    if (!readiness.serviceReady) readiness.services = [];
    return readiness;
  }
  async mySummary(userId: string): Promise<ProviderServiceReadiness | null> {
    const application = await this.dataSource.manager.findOneBy(ProviderApplication, { userId });
    return application ? this.summary(application.id) : null;
  }
}
