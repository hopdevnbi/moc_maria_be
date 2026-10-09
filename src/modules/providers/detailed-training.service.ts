import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingModule } from './entities/training-module.entity';
import { TrainingCriterion } from './entities/training-criterion.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import { TrainingAssessment } from './entities/training-assessment.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { Service } from '../catalog/entities/service.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import {
  DetailedAssessmentDto,
  ModuleRequirementDto,
  TrainingCriterionDto,
} from './dto/training-assessment.dto';
import { trainingEvidenceBatch } from './training-evidence';
@Injectable()
export class DetailedTrainingService {
  constructor(private readonly dataSource: DataSource) {}
  private async course(
    manager: EntityManager,
    id: string,
    reason: string,
  ): Promise<TrainingCourse> {
    if (reason.trim().length < 3) throw new BadRequestException('Cần lý do ghi nhận.');
    const c = await manager.findOne(TrainingCourse, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!c) throw new NotFoundException('Không tìm thấy khóa học.');
    return c;
  }
  private async audit(
    manager: EntityManager,
    actor: string,
    event: string,
    reason: string,
    metadata: Record<string, unknown>,
    targetUserId: string | null = null,
  ): Promise<void> {
    await manager.save(AuditLog, {
      actorUserId: actor,
      event,
      targetUserId,
      metadata: { ...metadata, reason: reason.trim() },
    });
  }
  async requirements(
    id: string,
  ): Promise<{ modules: TrainingModule[]; criteria: TrainingCriterion[] }> {
    if (!(await this.dataSource.manager.findOneBy(TrainingCourse, { id })))
      throw new NotFoundException('Không tìm thấy khóa học.');
    const [modules, criteria] = await Promise.all([
      this.dataSource.manager.find(TrainingModule, {
        where: { courseId: id },
        order: { sortOrder: 'ASC', code: 'ASC' },
      }),
      this.dataSource.manager.find(TrainingCriterion, {
        where: { courseId: id },
        order: { code: 'ASC' },
      }),
    ]);
    return { modules, criteria };
  }
  async moduleRequirements(
    courseId: string,
    moduleId: string,
    actor: string,
    dto: ModuleRequirementDto,
  ): Promise<TrainingModule> {
    return this.dataSource.transaction(async (manager) => {
      const course = await this.course(manager, courseId, dto.reason);
      const module = await manager.findOneBy(TrainingModule, { id: moduleId, courseId });
      if (!module) throw new NotFoundException('Nội dung không thuộc khóa học.');
      if (dto.requirementsConfirmed !== true)
        throw new BadRequestException('Cần xác nhận yêu cầu đào tạo.');
      const previous = {
        minutes: module.requiredMinutes,
        required: module.isRequired,
        active: module.isActive,
      };
      Object.assign(module, {
        requiredMinutes: dto.requiredMinutes,
        isRequired: dto.isRequired,
        isActive: dto.isActive,
      });
      const saved = await manager.save(module);
      if (
        previous.minutes !== saved.requiredMinutes ||
        previous.required !== saved.isRequired ||
        previous.active !== saved.isActive
      ) {
        course.requirementsRevision += 1;
        await manager.save(course);
      }
      await this.audit(manager, actor, 'provider.training.requirements_updated', dto.reason, {
        courseId,
        moduleId,
        previous,
        minutes: saved.requiredMinutes,
        required: saved.isRequired,
        active: saved.isActive,
      });
      return saved;
    });
  }
  async criterion(
    courseId: string,
    id: string | null,
    actor: string,
    dto: TrainingCriterionDto,
  ): Promise<TrainingCriterion> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const course = await this.course(manager, courseId, dto.reason);
        if (dto.criteriaConfirmed !== true || dto.title.trim().length < 2)
          throw new BadRequestException('Cần tiêu chí và xác nhận đã kiểm tra.');
        if (dto.serviceId && !(await manager.findOneBy(Service, { id: dto.serviceId })))
          throw new NotFoundException('Không tìm thấy dịch vụ của tiêu chí.');
        const current = id ? await manager.findOneBy(TrainingCriterion, { id, courseId }) : null;
        if (id && !current) throw new NotFoundException('Tiêu chí không thuộc khóa học.');
        const saved = await manager.save(TrainingCriterion, {
          ...(current || {}),
          courseId,
          code: dto.code,
          title: dto.title.trim(),
          serviceId: dto.serviceId || null,
          minimumScore: dto.minimumScore,
          isRequired: dto.isRequired,
          isActive: dto.isActive,
        });
        if (
          !current ||
          current.code !== saved.code ||
          current.minimumScore !== saved.minimumScore ||
          current.serviceId !== saved.serviceId ||
          current.isRequired !== saved.isRequired ||
          current.isActive !== saved.isActive
        ) {
          course.requirementsRevision += 1;
          await manager.save(course);
        }
        await this.audit(manager, actor, 'provider.training.criterion_recorded', dto.reason, {
          courseId,
          criterionId: saved.id,
          previous: current
            ? {
                minimumScore: current.minimumScore,
                isRequired: current.isRequired,
                isActive: current.isActive,
                serviceId: current.serviceId,
              }
            : null,
          minimumScore: saved.minimumScore,
          isRequired: saved.isRequired,
          isActive: saved.isActive,
          serviceId: saved.serviceId,
        });
        return saved;
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505')
        throw new ConflictException('Mã tiêu chí đã tồn tại trong khóa học.');
      throw error;
    }
  }
  async assessment(
    id: string,
    actor: string,
    dto: DetailedAssessmentDto,
  ): Promise<TrainingEnrollment> {
    return this.dataSource.transaction(async (manager) => {
      const enrollment = await manager.findOneBy(TrainingEnrollment, { id });
      if (!enrollment) throw new NotFoundException('Không tìm thấy ghi danh.');
      const app = await manager.findOne(ProviderApplication, {
        where: { id: enrollment.providerApplicationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!app) throw new NotFoundException('Không tìm thấy chuyên viên.');
      if (app.userId === actor) throw new BadRequestException('Không được tự đánh giá tay nghề.');
      if (!['TRAINING', 'ASSESSMENT', 'APPROVED', 'SUSPENDED'].includes(app.status))
        throw new BadRequestException('Hồ sơ chưa ở giai đoạn đánh giá hoặc đào tạo lại.');
      const course = await this.course(manager, enrollment.courseId, dto.reason);
      if (!course.isActive) throw new BadRequestException('Khóa học không hoạt động.');
      const evidence = (await trainingEvidenceBatch(manager, [enrollment])).get(id)!;
      if (!evidence.requirementsConfigured)
        throw new BadRequestException(
          'Cần khối lượng học bắt buộc và tiêu chí thực hành trước khi đánh giá.',
        );
      const validUntil = new Date(dto.validUntil);
      if (validUntil <= new Date() || dto.practicalConfirmed !== true)
        throw new BadRequestException('Cần xác nhận sát hạch thực tế và thời hạn còn hiệu lực.');
      if (
        new Set(dto.scores.map((s) => s.criterionId)).size !== dto.scores.length ||
        dto.scores.some((s) => !evidence.criteria.some((c) => c.id === s.criterionId))
      )
        throw new BadRequestException('Tiêu chí trùng hoặc không thuộc chương trình hiện hành.');
      const results = evidence.criteria.map((c) => ({
        criterionId: c.id,
        code: c.code,
        title: c.title,
        serviceId: c.serviceId,
        minimumScore: c.minimumScore,
        isRequired: c.isRequired,
        score: dto.scores.find((s) => s.criterionId === c.id)?.score ?? null,
      }));
      if (results.some((c) => c.isRequired && c.score === null))
        throw new BadRequestException('Cần kết quả cho mọi tiêu chí bắt buộc.');
      const passed =
        evidence.attendanceReady &&
        results
          .filter((c) => c.isRequired)
          .every((c) => c.score !== null && c.score >= c.minimumScore);
      const record = await manager.save(TrainingAssessment, {
        enrollmentId: id,
        evidenceFingerprint: evidence.fingerprint,
        attendancePercent: evidence.attendancePercent,
        passed,
        validUntil,
        evidenceReference: dto.evidenceReference,
        reason: dto.reason.trim(),
        assessedBy: actor,
        assessedAt: new Date(),
        snapshot: {
          requirementsRevision: evidence.requirementsRevision,
          modules: evidence.modules,
          criteria: results,
          attendanceReady: evidence.attendanceReady,
        },
      });
      enrollment.latestAssessmentId = record.id;
      enrollment.attendancePercent = evidence.attendancePercent;
      enrollment.assessmentPassed = passed;
      enrollment.status = passed ? 'COMPLETED' : 'FAILED';
      enrollment.assessedBy = actor;
      enrollment.assessedAt = record.assessedAt;
      const saved = await manager.save(enrollment);
      await this.audit(
        manager,
        actor,
        'provider.training.assessment_recorded',
        dto.reason,
        {
          applicationId: app.id,
          enrollmentId: id,
          assessmentId: record.id,
          passed,
          attendancePercent: evidence.attendancePercent,
        },
        app.userId,
      );
      return saved;
    });
  }
  async assessmentView(id: string): Promise<Record<string, unknown>> {
    const manager = this.dataSource.manager;
    const enrollment = await manager.findOneBy(TrainingEnrollment, { id });
    if (!enrollment) throw new NotFoundException('Không tìm thấy ghi danh.');
    const [evidence, history] = await Promise.all([
      trainingEvidenceBatch(manager, [enrollment]),
      manager.find(TrainingAssessment, {
        where: { enrollmentId: id },
        order: { assessedAt: 'DESC', id: 'DESC' },
      }),
    ]);
    const current = evidence.get(id)!;
    const latest = history.find((a) => a.id === enrollment.latestAssessmentId);
    return {
      enrollmentId: id,
      courseId: enrollment.courseId,
      modules: current.modules,
      criteria: current.criteria,
      requirementsConfigured: current.requirementsConfigured,
      attendanceReady: current.attendanceReady,
      attendancePercent: current.attendancePercent,
      latestAssessment: latest || null,
      evidenceCurrent: !!(
        latest?.passed &&
        latest.validUntil > new Date() &&
        current.courseActive &&
        current.attendanceReady &&
        latest.evidenceFingerprint === current.fingerprint
      ),
      history,
    };
  }
}
