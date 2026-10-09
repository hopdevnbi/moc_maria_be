import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ProviderApplication } from './entities/provider-application.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import { TrainingAssessment } from './entities/training-assessment.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { CertificateIssuance } from './entities/certificate-issuance.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { IssueCertificateDto } from './dto/certificate.dto';
import { trainingEvidenceBatch } from './training-evidence';
// Caller holds provider application lock; course lock is acquired second, matching attendance/assessment writes.
export async function writeEvidenceCertificate(
  manager: EntityManager,
  app: ProviderApplication,
  actor: string,
  dto: IssueCertificateDto,
  renewId: string | null = null,
): Promise<ProviderCertificate> {
  if (app.userId === actor)
    throw new BadRequestException('Không được tự cấp hoặc gia hạn chứng nhận.');
  if (!['TRAINING', 'ASSESSMENT', 'APPROVED'].includes(app.status))
    throw new BadRequestException('Hồ sơ cần được xem xét trước khi cấp chứng nhận.');
  if (dto.issuedConfirmed !== true || !dto.reason || dto.reason.trim().length < 3)
    throw new BadRequestException('Cần xác nhận bằng chứng và lý do cấp/gia hạn.');
  const course = await manager.findOne(TrainingCourse, {
    where: { code: dto.courseCode },
    lock: { mode: 'pessimistic_write' },
  });
  if (!course?.isActive) throw new NotFoundException('Không tìm thấy khóa học đang hoạt động.');
  const enrollment = await manager.findOneBy(TrainingEnrollment, {
    providerApplicationId: app.id,
    courseId: course.id,
  });
  const assessment = enrollment?.latestAssessmentId
    ? await manager.findOneBy(TrainingAssessment, {
        id: enrollment.latestAssessmentId,
        enrollmentId: enrollment.id,
      })
    : null;
  const evidence = enrollment
    ? (await trainingEvidenceBatch(manager, [enrollment])).get(enrollment.id)
    : null;
  const now = new Date(),
    expiry = dto.expiresAt ? new Date(dto.expiresAt) : null;
  if (
    !assessment?.passed ||
    assessment.validUntil <= now ||
    !evidence?.attendanceReady ||
    assessment.evidenceFingerprint !== evidence.fingerprint ||
    enrollment?.status !== 'COMPLETED'
  )
    throw new BadRequestException('Cần sát hạch đạt, điểm danh và yêu cầu đào tạo hiện hành.');
  if (
    !expiry ||
    !Number.isFinite(expiry.getTime()) ||
    expiry <= now ||
    expiry > assessment.validUntil
  )
    throw new BadRequestException('Hạn chứng nhận phải còn hiệu lực và không vượt hạn đánh giá.');
  const existing = await manager.findOneBy(ProviderCertificate, {
    providerApplicationId: app.id,
    courseCode: course.code,
  });
  if (renewId && (!existing || existing.id !== renewId))
    throw new NotFoundException('Chứng nhận không thuộc hồ sơ/khóa học.');
  if (existing && !renewId)
    throw new ConflictException('Khóa đã có chứng nhận. Dùng gia hạn sau lần sát hạch mới.');
  if (
    existing &&
    (assessment.id === existing.assessmentId || assessment.assessedAt <= existing.issuedAt)
  )
    throw new BadRequestException('Gia hạn cần một lần sát hạch mới sau lần cấp trước.');
  if (
    existing?.revokedAt &&
    (app.status !== 'ASSESSMENT' || assessment.assessedAt <= existing.revokedAt)
  )
    throw new BadRequestException(
      'Chứng nhận thu hồi cần xét lại hồ sơ và sát hạch sau thu hồi; không tự khôi phục quyền phục vụ.',
    );
  if (await manager.findOneBy(CertificateIssuance, { certificateNumber: dto.certificateNumber }))
    throw new ConflictException('Số chứng nhận đã dùng trong lịch sử; cần số mới.');
  const previous = existing
    ? {
        certificateNumber: existing.certificateNumber,
        issuedAt: existing.issuedAt.toISOString(),
        expiresAt: existing.expiresAt?.toISOString() || null,
        revokedAt: existing.revokedAt?.toISOString() || null,
        assessmentId: existing.assessmentId,
      }
    : null;
  try {
    const saved = await manager.save(ProviderCertificate, {
      ...(existing || {}),
      providerApplicationId: app.id,
      courseCode: course.code,
      title: course.title.slice(0, 160),
      certificateNumber: dto.certificateNumber,
      issuedAt: now,
      expiresAt: expiry,
      revokedAt: null,
      issuedBy: actor,
      assessmentId: assessment.id,
    });
    await manager.save(CertificateIssuance, {
      certificateId: saved.id,
      certificateNumber: saved.certificateNumber,
      kind: existing ? 'RENEWED' : 'ISSUED',
      assessmentId: assessment.id,
      issuedAt: now,
      expiresAt: expiry,
      issuedBy: actor,
      reason: dto.reason.trim(),
      previousSnapshot: previous,
    });
    await manager.save(AuditLog, {
      event: existing ? 'provider.certificate.renewed' : 'provider.certificate.issued',
      actorUserId: actor,
      targetUserId: app.userId,
      metadata: {
        applicationId: app.id,
        certificateId: saved.id,
        assessmentId: assessment.id,
        courseCode: course.code,
        reason: dto.reason.trim(),
      },
    });
    return saved;
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505')
      throw new ConflictException('Số chứng nhận đã được dùng; tải lại và kiểm tra lịch sử.');
    throw error;
  }
}
