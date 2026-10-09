import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  assess(_id: string, _assessorId: string, _dto: AssessEnrollmentDto): Promise<TrainingEnrollment> {
    return Promise.reject(
      new BadRequestException(
        'Đánh giá bằng tỷ lệ nhập tay đã ngưng. Dùng sát hạch theo tiêu chí và điểm danh buổi học.',
      ),
    );
  }

  listEnrollments(providerApplicationId: string): Promise<TrainingEnrollment[]> {
    return this.enrollments.find({ where: { providerApplicationId } });
  }
}
