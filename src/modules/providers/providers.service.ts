import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import { ApplyProviderDto, ReviewProviderDto } from './dto/provider-application.dto';
import { IssueCertificateDto } from './dto/certificate.dto';

@Injectable()
export class ProvidersService {
  constructor(
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
    return this.applications.save(
      this.applications.create({
        userId,
        publicName: dto.publicName.trim(),
        introduction: dto.introduction?.trim() ?? null,
        serviceArea: dto.serviceArea?.trim() ?? null,
        status: 'APPLIED',
      }),
    );
  }

  myApplication(userId: string): Promise<ProviderApplication | null> {
    return this.applications.findOneBy({ userId });
  }

  listApplications(): Promise<ProviderApplication[]> {
    return this.applications.find({ order: { createdAt: 'DESC' } });
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
    return this.certificates.save(
      this.certificates.create({
        providerApplicationId: applicationId,
        courseCode: dto.courseCode,
        title: course.title,
        certificateNumber: dto.certificateNumber,
        issuedAt,
        expiresAt,
        revokedAt: null,
        issuedBy: actorId,
      }),
    );
  }

  async revokeCertificate(
    applicationId: string,
    certificateId: string,
  ): Promise<ProviderCertificate> {
    const cert = await this.certificates.findOneBy({
      id: certificateId,
      providerApplicationId: applicationId,
    });
    if (!cert) throw new NotFoundException('Không tìm thấy chứng nhận.');
    cert.revokedAt = new Date();
    const saved = await this.certificates.save(cert);
    const application = await this.applications.findOneBy({ id: applicationId });
    if (application?.status === 'APPROVED') {
      application.status = 'SUSPENDED';
      await this.applications.save(application);
    }
    return saved;
  }

  async review(id: string, actorId: string, dto: ReviewProviderDto): Promise<ProviderApplication> {
    const app = await this.applications.findOneBy({ id });
    if (!app) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    if (actorId === app.userId) throw new BadRequestException('Không được tự duyệt hồ sơ.');
    if (dto.status === 'APPROVED') {
      const certs = await this.certificates.find({ where: { providerApplicationId: id } });
      const now = Date.now();
      if (!certs.some((c) => !c.revokedAt && (!c.expiresAt || c.expiresAt.getTime() > now))) {
        throw new BadRequestException('KTV chưa có chứng nhận đào tạo nội bộ hợp lệ.');
      }
    }
    app.status = dto.status;
    app.reviewedBy = actorId;
    app.reviewNote = dto.note?.trim() ?? null;
    return this.applications.save(app);
  }

  async publicProviders(): Promise<
    Array<{
      id: string;
      publicName: string;
      introduction: string | null;
      serviceArea: string | null;
      avatarUrl: string | null;
    }>
  > {
    const approved = await this.applications.find({ where: { status: 'APPROVED' } });
    const result: Array<{
      id: string;
      publicName: string;
      introduction: string | null;
      serviceArea: string | null;
      avatarUrl: string | null;
    }> = [];
    for (const app of approved) {
      const profile = await this.profiles.findOneBy({
        userId: app.userId,
        isActive: true,
        isPublic: true,
      });
      if (!profile) continue;
      const certs = await this.certificates.find({ where: { providerApplicationId: app.id } });
      if (!certs.some((c) => !c.revokedAt && (!c.expiresAt || c.expiresAt.getTime() > Date.now())))
        continue;
      result.push({
        id: app.id,
        publicName: app.publicName,
        introduction: app.introduction,
        serviceArea: app.serviceArea,
        avatarUrl: profile.avatarUrl,
      });
    }
    return result;
  }
}
