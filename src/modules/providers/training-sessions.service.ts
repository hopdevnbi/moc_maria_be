import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { User } from '../identity/entities/user.entity';
import { Branch } from '../catalog/entities/branch.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import { TrainingModule } from './entities/training-module.entity';
import { TrainingSession } from './entities/training-session.entity';
import { TrainingSessionRoster } from './entities/training-session-roster.entity';
import { TrainingAttendance } from './entities/training-attendance.entity';
import { TrainingAttendanceEvent } from './entities/training-attendance-event.entity';
import {
  CreateTrainingModuleDto,
  CreateTrainingSessionDto,
  MarkTrainingAttendanceDto,
  RecordTrainingSessionDto,
  RegisterTrainingSessionDto,
} from './dto/training-session.dto';

interface Instructor {
  id: string;
  displayName: string;
}
interface SessionSummary {
  sessionId: string;
  moduleId: string;
  moduleTitle: string;
  isRequired: boolean;
  startsAt: Date;
  endsAt: Date;
  status: string;
  instructorName: string;
  branchName: string | null;
}
interface EnrollmentSessions {
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  availableSessions: SessionSummary[];
  records: Array<
    SessionSummary & {
      isActive: boolean;
      attendance: {
        status: string;
        attendedMinutes: number;
        evidenceReference?: string;
        markedAt: Date;
        history?: Array<{
          status: string;
          attendedMinutes: number;
          evidenceReference: string;
          reason: string;
          markedAt: Date;
        }>;
      } | null;
    }
  >;
}

@Injectable()
export class TrainingSessionsService {
  constructor(private readonly dataSource: DataSource) {}

  private audit(
    manager: EntityManager,
    actor: string,
    event: string,
    reason: string,
    metadata: Record<string, unknown>,
    targetUserId: string | null = null,
  ): Promise<AuditLog> {
    return manager.save(AuditLog, {
      actorUserId: actor,
      targetUserId,
      event,
      metadata: { ...metadata, reason: reason.trim() },
    });
  }
  private async course(
    manager: EntityManager,
    id: string,
    reason: string,
  ): Promise<TrainingCourse> {
    if (reason.trim().length < 3) throw new BadRequestException('Cần lý do ghi nhận đào tạo.');
    const course = await manager.findOne(TrainingCourse, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!course) throw new NotFoundException('Không tìm thấy khóa đào tạo.');
    return course;
  }
  private async enrollment(
    manager: EntityManager,
    id: string,
    actor: string,
    reason: string,
  ): Promise<{ enrollment: TrainingEnrollment; application: ProviderApplication }> {
    const enrollment = await manager.findOneBy(TrainingEnrollment, { id });
    if (!enrollment) throw new NotFoundException('Không tìm thấy ghi danh.');
    const application = await manager.findOne(ProviderApplication, {
      where: { id: enrollment.providerApplicationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!application) throw new NotFoundException('Không tìm thấy hồ sơ chuyên viên.');
    if (application.userId === actor)
      throw new BadRequestException('Không được tự xếp buổi học hoặc xác nhận điểm danh của mình.');
    if (
      !['REVIEWING', 'TRAINING', 'ASSESSMENT', 'APPROVED', 'SUSPENDED'].includes(application.status)
    )
      throw new BadRequestException('Hồ sơ chưa được chỉ định đào tạo.');
    await this.course(manager, enrollment.courseId, reason);
    return { enrollment, application };
  }
  instructors(): Promise<Instructor[]> {
    return this.dataSource.query<Instructor[]>(
      `SELECT DISTINCT u.id,u.display_name AS "displayName" FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.is_active AND r.name=ANY($1::text[]) ORDER BY u.display_name,u.id`,
      [['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'THERAPIST', 'DOCTOR_CONSULTANT']],
    );
  }
  async program(id: string): Promise<{ modules: TrainingModule[]; sessions: TrainingSession[] }> {
    const manager = this.dataSource.manager;
    if (!(await manager.findOneBy(TrainingCourse, { id })))
      throw new NotFoundException('Không tìm thấy khóa học.');
    const modules = await manager.find(TrainingModule, {
      where: { courseId: id },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
    const sessions = modules.length
      ? await manager.find(TrainingSession, {
          where: { moduleId: In(modules.map((m) => m.id)) },
          order: { startsAt: 'ASC' },
        })
      : [];
    return { modules, sessions };
  }
  async createModule(
    courseId: string,
    actor: string,
    dto: CreateTrainingModuleDto,
  ): Promise<TrainingModule> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const course = await this.course(manager, courseId, dto.reason);
        if (!course.isActive || dto.title.trim().length < 2)
          throw new BadRequestException('Khóa học phải hoạt động và cần tên nội dung hợp lệ.');
        const module = await manager.save(TrainingModule, {
          courseId,
          code: dto.code,
          title: dto.title.trim(),
          sortOrder: dto.sortOrder,
          isRequired: dto.isRequired,
          isActive: true,
        });
        if (module.isRequired) {
          course.requirementsRevision += 1;
          await manager.save(course);
        }
        await this.audit(manager, actor, 'provider.training.module_created', dto.reason, {
          courseId,
          moduleId: module.id,
        });
        return module;
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505')
        throw new ConflictException('Mã nội dung trong khóa học đã tồn tại.');
      throw error;
    }
  }
  async createSession(
    courseId: string,
    actor: string,
    dto: CreateTrainingSessionDto,
  ): Promise<TrainingSession> {
    return this.dataSource.transaction(async (manager) => {
      const course = await this.course(manager, courseId, dto.reason);
      const module = await manager.findOneBy(TrainingModule, {
        id: dto.moduleId,
        courseId,
        isActive: true,
      });
      if (!course.isActive || !module)
        throw new BadRequestException('Nội dung không thuộc khóa đang hoạt động.');
      const startsAt = new Date(dto.startsAt),
        endsAt = new Date(dto.endsAt);
      const minutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480)
        throw new BadRequestException('Buổi học cần từ 1 phút đến 8 giờ.');
      const instructor = await manager.findOne(User, {
        where: { id: dto.instructorUserId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      const allowed = await manager.query<Array<{ id: string }>>(
        `SELECT ur.user_id AS id FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.name=ANY($2::text[]) LIMIT 1`,
        [
          dto.instructorUserId,
          ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'THERAPIST', 'DOCTOR_CONSULTANT'],
        ],
      );
      if (!instructor || !allowed.length)
        throw new BadRequestException('Người phụ trách phải là nhân sự có tài khoản hoạt động.');
      if (dto.branchId && !(await manager.findOneBy(Branch, { id: dto.branchId, isActive: true })))
        throw new BadRequestException('Cơ sở không hoạt động.');
      const overlaps = await manager
        .getRepository(TrainingSession)
        .createQueryBuilder('session')
        .where('session.instructor_user_id=:id', { id: dto.instructorUserId })
        .andWhere('session.status <> :cancelled', { cancelled: 'CANCELLED' })
        .andWhere('session.starts_at < :end AND session.ends_at > :start', {
          start: startsAt,
          end: endsAt,
        })
        .getCount();
      if (overlaps) throw new ConflictException('Người phụ trách đã có buổi học trùng thời gian.');
      const saved = await manager.save(TrainingSession, {
        moduleId: module.id,
        branchId: dto.branchId ?? null,
        instructorUserId: dto.instructorUserId,
        startsAt,
        endsAt,
        status: 'PLANNED' as const,
        completionReference: null,
        recordedBy: null,
        recordedAt: null,
      });
      await this.audit(manager, actor, 'provider.training.session_created', dto.reason, {
        courseId,
        sessionId: saved.id,
      });
      return saved;
    });
  }
  async recordSession(
    id: string,
    actor: string,
    dto: RecordTrainingSessionDto,
  ): Promise<TrainingSession> {
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.findOneBy(TrainingSession, { id });
      if (!session) throw new NotFoundException('Không tìm thấy buổi học.');
      const module = await manager.findOneByOrFail(TrainingModule, { id: session.moduleId });
      await this.course(manager, module.courseId, dto.reason);
      const latest = await manager.findOneByOrFail(TrainingSession, { id });
      if (latest.status !== 'PLANNED')
        throw new ConflictException(
          'Buổi học đã được chốt. Tạo buổi mới để bổ sung, không sửa lịch sử.',
        );
      if (dto.status === 'COMPLETED') {
        if (latest.endsAt.getTime() > Date.now())
          throw new BadRequestException('Buổi học chưa kết thúc.');
        if (!dto.completionReference)
          throw new BadRequestException('Cần mã biên bản buổi học thực tế.');
        const own = await manager.query<Array<{ id: string }>>(
          `SELECT r.id FROM provider_training_session_roster r JOIN provider_training_enrollments e ON e.id=r.enrollment_id JOIN provider_applications a ON a.id=e.provider_application_id WHERE r.session_id=$1 AND r.is_active AND a.user_id=$2 LIMIT 1`,
          [id, actor],
        );
        if (own.length)
          throw new BadRequestException('Không được tự chốt buổi học mà mình tham gia.');
      }
      latest.status = dto.status;
      latest.completionReference = dto.status === 'COMPLETED' ? dto.completionReference! : null;
      latest.recordedBy = actor;
      latest.recordedAt = new Date();
      const saved = await manager.save(latest);
      await this.audit(manager, actor, 'provider.training.session_recorded', dto.reason, {
        sessionId: id,
        status: dto.status,
      });
      return saved;
    });
  }
  async register(
    enrollmentId: string,
    actor: string,
    dto: RegisterTrainingSessionDto,
  ): Promise<TrainingSessionRoster> {
    return this.dataSource.transaction(async (manager) => {
      const { enrollment, application } = await this.enrollment(
        manager,
        enrollmentId,
        actor,
        dto.reason,
      );
      const session = await manager.findOneBy(TrainingSession, { id: dto.sessionId });
      const module = session
        ? await manager.findOneBy(TrainingModule, {
            id: session.moduleId,
            courseId: enrollment.courseId,
            isActive: true,
          })
        : null;
      if (!session || !module)
        throw new BadRequestException('Buổi học không thuộc khóa của ghi danh.');
      if (session.status !== 'PLANNED')
        throw new BadRequestException('Chỉ đổi danh sách trước khi chốt buổi học.');
      if (dto.isActive) {
        const rows = await manager.query<Array<{ id: string }>>(
          `SELECT s.id FROM provider_training_session_roster r JOIN provider_training_enrollments e ON e.id=r.enrollment_id JOIN provider_training_sessions s ON s.id=r.session_id WHERE e.provider_application_id=$1 AND r.is_active AND s.status<>'CANCELLED' AND s.id<>$2 AND s.starts_at<$3 AND s.ends_at>$4 LIMIT 1`,
          [application.id, session.id, session.endsAt, session.startsAt],
        );
        if (rows.length)
          throw new ConflictException('Chuyên viên đã được xếp buổi học trùng thời gian.');
      }
      await manager.upsert(
        TrainingSessionRoster,
        {
          sessionId: session.id,
          enrollmentId,
          isActive: dto.isActive,
          addedBy: actor,
          addedAt: new Date(),
        },
        ['sessionId', 'enrollmentId'],
      );
      const saved = await manager.findOneByOrFail(TrainingSessionRoster, {
        sessionId: session.id,
        enrollmentId,
      });
      await this.audit(
        manager,
        actor,
        'provider.training.session_registration',
        dto.reason,
        { rosterId: saved.id, enrollmentId, isActive: dto.isActive },
        application.userId,
      );
      return saved;
    });
  }
  async markAttendance(
    enrollmentId: string,
    sessionId: string,
    actor: string,
    dto: MarkTrainingAttendanceDto,
  ): Promise<TrainingAttendance> {
    return this.dataSource.transaction(async (manager) => {
      const { enrollment, application } = await this.enrollment(
        manager,
        enrollmentId,
        actor,
        dto.reason,
      );
      const roster = await manager.findOneBy(TrainingSessionRoster, {
        sessionId,
        enrollmentId,
        isActive: true,
      });
      const session = await manager.findOneBy(TrainingSession, { id: sessionId });
      const module = session
        ? await manager.findOneBy(TrainingModule, {
            id: session.moduleId,
            courseId: enrollment.courseId,
          })
        : null;
      if (
        !roster ||
        !session ||
        !module ||
        session.status !== 'COMPLETED' ||
        session.endsAt.getTime() > Date.now()
      )
        throw new BadRequestException(
          'Cần buổi học hoàn tất và có tên chuyên viên trong danh sách.',
        );
      const duration = Math.floor((session.endsAt.getTime() - session.startsAt.getTime()) / 60000);
      if (dto.attendedMinutes > duration || (dto.status !== 'PRESENT' && dto.attendedMinutes !== 0))
        throw new BadRequestException(
          'Số phút có mặt không phù hợp buổi học hoặc trạng thái vắng.',
        );
      const previous = await manager.findOneBy(TrainingAttendance, { rosterId: roster.id });
      await manager.upsert(
        TrainingAttendance,
        {
          rosterId: roster.id,
          status: dto.status,
          attendedMinutes: dto.attendedMinutes,
          evidenceReference: dto.evidenceReference,
          markedBy: actor,
          markedAt: new Date(),
        },
        ['rosterId'],
      );
      const saved = await manager.findOneByOrFail(TrainingAttendance, { rosterId: roster.id });
      await manager.save(TrainingAttendanceEvent, {
        attendanceId: saved.id,
        status: saved.status,
        attendedMinutes: saved.attendedMinutes,
        evidenceReference: saved.evidenceReference,
        reason: dto.reason.trim(),
        markedBy: actor,
        markedAt: saved.markedAt,
      });
      await this.audit(
        manager,
        actor,
        'provider.training.attendance_recorded',
        dto.reason,
        {
          enrollmentId,
          sessionId,
          attendanceId: saved.id,
          previous: previous
            ? { status: previous.status, attendedMinutes: previous.attendedMinutes }
            : null,
          status: dto.status,
          attendedMinutes: dto.attendedMinutes,
        },
        application.userId,
      );
      return saved;
    });
  }
  async enrollmentSessions(id: string, privateEvidence = true): Promise<EnrollmentSessions> {
    const manager = this.dataSource.manager;
    const enrollment = await manager.findOneBy(TrainingEnrollment, { id });
    if (!enrollment) throw new NotFoundException('Không tìm thấy ghi danh.');
    const course = await manager.findOneByOrFail(TrainingCourse, { id: enrollment.courseId });
    const { modules, sessions } = await this.program(course.id);
    const roster = await manager.find(TrainingSessionRoster, { where: { enrollmentId: id } });
    const [attendance, instructors, branches] = await Promise.all([
      roster.length
        ? manager.find(TrainingAttendance, { where: { rosterId: In(roster.map((r) => r.id)) } })
        : [],
      sessions.length
        ? manager.find(User, {
            select: ['id', 'displayName'],
            where: { id: In(sessions.map((s) => s.instructorUserId)) },
          })
        : [],
      sessions.some((s) => s.branchId)
        ? manager.find(Branch, {
            where: { id: In(sessions.flatMap((s) => (s.branchId ? [s.branchId] : []))) },
          })
        : [],
    ]);
    const summary = (session: TrainingSession): SessionSummary => {
      const module = modules.find((m) => m.id === session.moduleId)!;
      return {
        sessionId: session.id,
        moduleId: module.id,
        moduleTitle: module.title,
        isRequired: module.isRequired,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        status: session.status,
        instructorName:
          instructors.find((u) => u.id === session.instructorUserId)?.displayName ??
          'Người phụ trách đào tạo',
        branchName: branches.find((b) => b.id === session.branchId)?.name ?? null,
      };
    };
    const history =
      privateEvidence && attendance.length
        ? await manager.find(TrainingAttendanceEvent, {
            where: { attendanceId: In(attendance.map((a) => a.id)) },
            order: { markedAt: 'ASC', id: 'ASC' },
          })
        : [];
    return {
      enrollmentId: id,
      courseId: course.id,
      courseTitle: course.title,
      availableSessions: privateEvidence
        ? sessions
            .filter(
              (s) =>
                s.status === 'PLANNED' && modules.some((m) => m.id === s.moduleId && m.isActive),
            )
            .map(summary)
        : [],
      records: roster
        .filter((r) => privateEvidence || r.isActive)
        .map((r) => {
          const session = sessions.find((s) => s.id === r.sessionId)!;
          const a = attendance.find((a) => a.rosterId === r.id);
          return {
            ...summary(session),
            isActive: r.isActive,
            attendance: a
              ? {
                  status: a.status,
                  attendedMinutes: a.attendedMinutes,
                  markedAt: a.markedAt,
                  ...(privateEvidence
                    ? {
                        evidenceReference: a.evidenceReference,
                        history: history
                          .filter((h) => h.attendanceId === a.id)
                          .map((h) => ({
                            status: h.status,
                            attendedMinutes: h.attendedMinutes,
                            evidenceReference: h.evidenceReference,
                            reason: h.reason,
                            markedAt: h.markedAt,
                          })),
                      }
                    : {}),
                }
              : null,
          };
        }),
    };
  }
  async ownSessions(userId: string): Promise<EnrollmentSessions[]> {
    const application = await this.dataSource.manager.findOneBy(ProviderApplication, { userId });
    if (!application) return [];
    const enrollments = await this.dataSource.manager.find(TrainingEnrollment, {
      where: { providerApplicationId: application.id },
    });
    return Promise.all(enrollments.map((e) => this.enrollmentSessions(e.id, false)));
  }
}
