import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import {
  AssessEnrollmentDto,
  CreateTrainingCourseDto,
  EnrollProviderDto,
} from './dto/training.dto';

@Injectable()
export class TrainingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProviderApplication)
    private readonly applications: Repository<ProviderApplication>,
    @InjectRepository(TrainingCourse) private readonly courses: Repository<TrainingCourse>,
    @InjectRepository(TrainingEnrollment)
    private readonly enrollments: Repository<TrainingEnrollment>,
  ) {}

  listCourses(): Promise<TrainingCourse[]> {
    return this.courses.find({ order: { code: 'ASC' } });
  }

  async createCourse(dto: CreateTrainingCourseDto): Promise<TrainingCourse> {
    try {
      return await this.courses.save(
        this.courses.create({
          code: dto.code,
          title: dto.title.trim(),
          description: dto.description?.trim() ?? null,
          isActive: true,
        }),
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException('Mã khóa học đã tồn tại.');
      }
      throw error;
    }
  }

  async enroll(dto: EnrollProviderDto): Promise<TrainingEnrollment> {
    const applicant = await this.applications.findOneBy({ id: dto.providerApplicationId });
    if (!applicant) throw new NotFoundException('Không tìm thấy KTV.');
    if (!['REVIEWING', 'TRAINING', 'ASSESSMENT'].includes(applicant.status)) {
      throw new BadRequestException('Hồ sơ KTV chưa phù hợp để tham gia khóa học.');
    }
    const course = await this.courses.findOneBy({ id: dto.courseId, isActive: true });
    if (!course) throw new NotFoundException('Khóa học không hoạt động.');
    const existing = await this.enrollments.findOneBy({
      providerApplicationId: dto.providerApplicationId,
      courseId: dto.courseId,
    });
    if (existing) throw new ConflictException('KTV đã được ghi danh khóa học này.');
    return this.enrollments.save(
      this.enrollments.create({
        providerApplicationId: dto.providerApplicationId,
        courseId: dto.courseId,
        status: 'ENROLLED',
        attendancePercent: 0,
        assessmentPassed: false,
        assessedAt: null,
        assessedBy: null,
      }),
    );
  }

  async assess(
    id: string,
    assessorId: string,
    dto: AssessEnrollmentDto,
  ): Promise<TrainingEnrollment> {
    const enrollment = await this.enrollments.findOneBy({ id });
    if (!enrollment) throw new NotFoundException('Không tìm thấy ghi danh.');
    const applicant = await this.applications.findOneBy({ id: enrollment.providerApplicationId });
    if (!applicant) throw new NotFoundException('Không tìm thấy KTV.');
    if (applicant.userId === assessorId)
      throw new BadRequestException('Không được tự đánh giá tay nghề.');
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOneOrFail(ProviderApplication, {
        where: { id: applicant.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!['TRAINING', 'ASSESSMENT'].includes(current.status))
        throw new BadRequestException('Hồ sơ không ở giai đoạn đánh giá đào tạo.');
      const latest = await manager.findOneOrFail(TrainingEnrollment, { where: { id } });
      const passed = dto.assessmentPassed && dto.attendancePercent >= 80;
      latest.attendancePercent = dto.attendancePercent;
      latest.assessmentPassed = passed;
      latest.status = passed ? 'COMPLETED' : 'FAILED';
      latest.assessedBy = assessorId;
      latest.assessedAt = new Date();
      const saved = await manager.save(latest);
      await manager.save(AuditLog, {
        event: 'provider.training.assessed',
        actorUserId: assessorId,
        targetUserId: applicant.userId,
        metadata: {
          applicationId: applicant.id,
          enrollmentId: id,
          attendancePercent: dto.attendancePercent,
          assessmentPassed: passed,
        },
      });
      return saved;
    });
  }

  listEnrollments(providerApplicationId: string): Promise<TrainingEnrollment[]> {
    return this.enrollments.find({ where: { providerApplicationId } });
  }
}
