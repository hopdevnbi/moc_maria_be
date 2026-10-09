import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { Branch } from '../catalog/entities/branch.entity';
import { BranchBusinessHour } from '../catalog/entities/branch-business-hour.entity';
import { BranchExceptionHour } from '../catalog/entities/branch-exception-hour.entity';
import { Service } from '../catalog/entities/service.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { currentCertificateEvidence } from './training-evidence';
import { TrainingCourse } from './entities/training-course.entity';
import { ProviderSkill } from './entities/provider-skill.entity';
import { ProviderBranchAssignment } from './entities/provider-branch-assignment.entity';
import { ProviderWeeklyShift } from './entities/provider-weekly-shift.entity';
import { ProviderDateSchedule } from './entities/provider-date-schedule.entity';
import {
  AddProviderDateScheduleDto,
  AddProviderWeeklyShiftDto,
  AssignProviderBranchDto,
  AssignProviderSkillDto,
  ProviderOperationReasonDto,
} from './dto/provider-schedule.dto';
import { overlaps, subtractTimeOff, validCalendarDate } from './provider-schedule-rules';
import type { MinuteWindow } from './provider-schedule-rules';

@Injectable()
export class ProviderScheduleService {
  constructor(private readonly dataSource: DataSource) {}

  private async lockedApplication(
    manager: EntityManager,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<ProviderApplication> {
    const application = await manager.findOne(ProviderApplication, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!application) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    if (application.userId === actorId)
      throw new BadRequestException('Không được tự phân công hoặc xác nhận kỹ năng/lịch.');
    if (reason.trim().length < 3) throw new BadRequestException('Cần lý do thay đổi rõ ràng.');
    return application;
  }

  private async audit(
    manager: EntityManager,
    application: ProviderApplication,
    actorId: string,
    event: string,
    reason: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await manager.save(AuditLog, {
      actorUserId: actorId,
      targetUserId: application.userId,
      event,
      metadata: { applicationId: application.id, reason: reason.trim(), ...metadata },
    });
  }

  async assignSkill(
    id: string,
    actorId: string,
    dto: AssignProviderSkillDto,
  ): Promise<ProviderSkill> {
    return this.dataSource.transaction(async (manager) => {
      const app = await this.lockedApplication(manager, id, actorId, dto.reason);
      if (!(await manager.findOneBy(Service, { id: dto.serviceId })))
        throw new NotFoundException('Không tìm thấy dịch vụ.');
      const cert = await manager.findOneBy(ProviderCertificate, {
        id: dto.certificateId,
        providerApplicationId: id,
      });
      if (!cert) throw new NotFoundException('Chứng nhận không thuộc KTV này.');
      if (dto.isActive !== false) {
        await manager.findOne(TrainingCourse, {
          where: { code: cert.courseCode },
          lock: { mode: 'pessimistic_write' },
        });
        if (!(await currentCertificateEvidence(manager, [cert])).has(cert.id))
          throw new BadRequestException('Chứng nhận cần sát hạch và điểm danh còn hiệu lực.');
      }
      await manager.upsert(
        ProviderSkill,
        {
          providerApplicationId: id,
          serviceId: dto.serviceId,
          certificateId: cert.id,
          isActive: dto.isActive ?? true,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
        ['providerApplicationId', 'serviceId'],
      );
      const saved = await manager.findOneByOrFail(ProviderSkill, {
        providerApplicationId: id,
        serviceId: dto.serviceId,
      });
      await this.audit(manager, app, actorId, 'provider.skill.assigned', dto.reason, {
        skillId: saved.id,
        serviceId: dto.serviceId,
        isActive: saved.isActive,
      });
      return saved;
    });
  }

  async assignBranch(
    id: string,
    actorId: string,
    dto: AssignProviderBranchDto,
  ): Promise<ProviderBranchAssignment> {
    return this.dataSource.transaction(async (manager) => {
      const app = await this.lockedApplication(manager, id, actorId, dto.reason);
      if (!(await manager.findOneBy(Branch, { id: dto.branchId })))
        throw new NotFoundException('Không tìm thấy cơ sở.');
      await manager.upsert(
        ProviderBranchAssignment,
        { providerApplicationId: id, branchId: dto.branchId, isActive: dto.isActive ?? true },
        ['providerApplicationId', 'branchId'],
      );
      const saved = await manager.findOneByOrFail(ProviderBranchAssignment, {
        providerApplicationId: id,
        branchId: dto.branchId,
      });
      await this.audit(manager, app, actorId, 'provider.branch.assigned', dto.reason, {
        branchId: dto.branchId,
        isActive: saved.isActive,
      });
      return saved;
    });
  }

  private async requireAssignment(
    manager: EntityManager,
    id: string,
    branchId: string,
  ): Promise<void> {
    if (
      !(await manager.findOneBy(Branch, { id: branchId, isActive: true })) ||
      !(await manager.findOneBy(ProviderBranchAssignment, {
        providerApplicationId: id,
        branchId,
        isActive: true,
      }))
    )
      throw new BadRequestException('KTV cần được phân công vào cơ sở đang hoạt động.');
  }

  async addWeeklyShift(
    id: string,
    actorId: string,
    dto: AddProviderWeeklyShiftDto,
  ): Promise<ProviderWeeklyShift> {
    if (dto.startsAtMinute >= dto.endsAtMinute)
      throw new BadRequestException(
        'Giờ kết thúc cần sau giờ bắt đầu; tách ca qua đêm thành hai ngày.',
      );
    return this.dataSource.transaction(async (manager) => {
      const app = await this.lockedApplication(manager, id, actorId, dto.reason);
      await this.requireAssignment(manager, id, dto.branchId);
      const shifts = await manager.find(ProviderWeeklyShift, {
        where: { providerApplicationId: id, weekday: dto.weekday, isActive: true },
      });
      if (shifts.some((shift) => overlaps(shift, dto)))
        throw new ConflictException('Ca làm trùng giờ với một ca khác của KTV, kể cả cơ sở khác.');
      const saved = await manager.save(ProviderWeeklyShift, {
        providerApplicationId: id,
        branchId: dto.branchId,
        weekday: dto.weekday,
        startsAtMinute: dto.startsAtMinute,
        endsAtMinute: dto.endsAtMinute,
        isActive: true,
      });
      await this.audit(manager, app, actorId, 'provider.shift.created', dto.reason, {
        shiftId: saved.id,
      });
      return saved;
    });
  }

  async addDateSchedule(
    id: string,
    actorId: string,
    dto: AddProviderDateScheduleDto,
  ): Promise<ProviderDateSchedule> {
    if (!validCalendarDate(dto.date) || dto.startsAtMinute >= dto.endsAtMinute)
      throw new BadRequestException('Ngày/khung giờ không hợp lệ.');
    if (dto.kind === 'OVERRIDE' ? !dto.branchId : !!dto.branchId)
      throw new BadRequestException('Ca riêng cần cơ sở; nghỉ phép áp dụng cho mọi cơ sở.');
    return this.dataSource.transaction(async (manager) => {
      const app = await this.lockedApplication(manager, id, actorId, dto.reason);
      if (dto.kind === 'OVERRIDE') {
        await this.requireAssignment(manager, id, dto.branchId!);
        const shifts = await manager.find(ProviderDateSchedule, {
          where: { providerApplicationId: id, date: dto.date, kind: 'OVERRIDE', isActive: true },
        });
        if (shifts.some((shift) => overlaps(shift, dto)))
          throw new ConflictException('Ca riêng trùng giờ với ca khác cùng ngày.');
      }
      const saved = await manager.save(ProviderDateSchedule, {
        providerApplicationId: id,
        branchId: dto.branchId ?? null,
        date: dto.date,
        kind: dto.kind,
        startsAtMinute: dto.startsAtMinute,
        endsAtMinute: dto.endsAtMinute,
        isActive: true,
      });
      await this.audit(manager, app, actorId, 'provider.date_schedule.created', dto.reason, {
        scheduleId: saved.id,
        kind: dto.kind,
      });
      return saved;
    });
  }

  async disableShift(
    id: string,
    recordId: string,
    actorId: string,
    dto: ProviderOperationReasonDto,
    dated: boolean,
  ): Promise<{ disabled: true }> {
    return this.dataSource.transaction(async (manager) => {
      const app = await this.lockedApplication(manager, id, actorId, dto.reason);
      const entity = dated ? ProviderDateSchedule : ProviderWeeklyShift;
      const record = await manager.findOneBy(entity, { id: recordId, providerApplicationId: id });
      if (!record) throw new NotFoundException('Không tìm thấy ca làm/nghỉ của KTV.');
      await manager.update(entity, record.id, { isActive: false });
      await this.audit(manager, app, actorId, 'provider.schedule.disabled', dto.reason, {
        scheduleId: recordId,
        dated,
      });
      return { disabled: true };
    });
  }

  async planning(id: string): Promise<unknown> {
    if (!(await this.dataSource.manager.findOneBy(ProviderApplication, { id })))
      throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    const where = { providerApplicationId: id };
    const [skills, assignments, weeklyShifts, datedSchedules, certificates] = await Promise.all([
      this.dataSource.manager.find(ProviderSkill, { where }),
      this.dataSource.manager.find(ProviderBranchAssignment, { where }),
      this.dataSource.manager.find(ProviderWeeklyShift, {
        where,
        order: { weekday: 'ASC', startsAtMinute: 'ASC' },
      }),
      this.dataSource.manager.find(ProviderDateSchedule, {
        where,
        order: { date: 'ASC', startsAtMinute: 'ASC' },
      }),
      this.dataSource.manager.find(ProviderCertificate, { where }),
    ]);
    const [branchSummaries, serviceSummaries] = await Promise.all([
      assignments.length
        ? this.dataSource.manager.find(Branch, {
            select: ['id', 'name'],
            where: { id: In(assignments.map((a) => a.branchId)) },
          })
        : [],
      skills.length
        ? this.dataSource.manager.find(Service, {
            select: ['id', 'name'],
            where: { id: In(skills.map((s) => s.serviceId)) },
          })
        : [],
    ]);
    const validCertificates = await currentCertificateEvidence(
      this.dataSource.manager,
      certificates,
    );
    return {
      timezone: 'Asia/Ho_Chi_Minh',
      branchSummaries,
      serviceSummaries,
      skills: skills.map(({ reviewedBy: _reviewer, ...skill }) => {
        const certificate = certificates.find((c) => c.id === skill.certificateId);
        return {
          ...skill,
          certificateValid: !!certificate && validCertificates.has(certificate.id),
        };
      }),
      assignments,
      weeklyShifts,
      datedSchedules,
      bookable: false,
      bookingBlockers: ['SERVICE_POLICY_LEGAL_TERRITORY_QUALITY_AND_BOOKING_GATE_PENDING'],
    };
  }

  async myPlanning(userId: string): Promise<unknown> {
    const application = await this.dataSource.manager.findOneBy(ProviderApplication, { userId });
    return application ? this.planning(application.id) : null;
  }

  // Internal planning windows only. They are not bookable slots until Phase04 resource/booking and eligibility checks.
  async windows(
    id: string,
    branchId: string,
    date: string,
  ): Promise<{ timezone: string; windows: MinuteWindow[]; bookable: false }> {
    if (!validCalendarDate(date)) throw new BadRequestException('Ngày không hợp lệ.');
    const manager = this.dataSource.manager;
    if (!(await manager.findOneBy(ProviderApplication, { id })))
      throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    const branch = await manager.findOneBy(Branch, { id: branchId, isActive: true });
    const assigned = await manager.findOneBy(ProviderBranchAssignment, {
      providerApplicationId: id,
      branchId,
      isActive: true,
    });
    const empty = { timezone: 'Asia/Ho_Chi_Minh', windows: [], bookable: false as const };
    if (!branch || !assigned) return empty;
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    const exception = await manager.findOneBy(BranchExceptionHour, { branchId, date });
    const hours = exception ?? (await manager.findOneBy(BranchBusinessHour, { branchId, weekday }));
    if (
      !hours ||
      ('isClosed' in hours && hours.isClosed) ||
      hours.opensAtMinute === null ||
      hours.closesAtMinute === null
    )
      return empty;
    const dated = await manager.find(ProviderDateSchedule, {
      where: { providerApplicationId: id, date, isActive: true },
    });
    const overrides = dated.filter((item) => item.kind === 'OVERRIDE');
    const shifts = overrides.length
      ? overrides.filter((item) => item.branchId === branchId)
      : await manager.find(ProviderWeeklyShift, {
          where: { providerApplicationId: id, branchId, weekday, isActive: true },
        });
    const windows = shifts
      .map((shift) => ({
        startsAtMinute: Math.max(shift.startsAtMinute, hours.opensAtMinute!),
        endsAtMinute: Math.min(shift.endsAtMinute, hours.closesAtMinute!),
      }))
      .filter((window) => window.startsAtMinute < window.endsAtMinute);
    return {
      timezone: 'Asia/Ho_Chi_Minh',
      windows: subtractTimeOff(
        windows,
        dated.filter((item) => item.kind === 'TIME_OFF'),
      ),
      bookable: false,
    };
  }
}
