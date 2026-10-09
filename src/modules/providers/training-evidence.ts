import { createHash } from 'node:crypto';
import { EntityManager, In } from 'typeorm';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import { TrainingModule } from './entities/training-module.entity';
import { TrainingCriterion } from './entities/training-criterion.entity';
import { TrainingSession } from './entities/training-session.entity';
import { TrainingSessionRoster } from './entities/training-session-roster.entity';
import { TrainingAttendance } from './entities/training-attendance.entity';
import { TrainingAssessment } from './entities/training-assessment.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';

export interface TrainingEvidence {
  enrollmentId: string;
  courseId: string;
  courseActive: boolean;
  requirementsRevision: number;
  fingerprint: string;
  attendancePercent: number;
  attendanceReady: boolean;
  requirementsConfigured: boolean;
  modules: Array<{
    id: string;
    title: string;
    requiredMinutes: number | null;
    attendedMinutes: number;
    attendancePercent: number;
  }>;
  criteria: TrainingCriterion[];
}
// Batch queries avoid one evidence query for every public provider/service grant.
export async function trainingEvidenceBatch(
  manager: EntityManager,
  enrollments: TrainingEnrollment[],
  at = new Date(),
): Promise<Map<string, TrainingEvidence>> {
  if (!enrollments.length) return new Map();
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  // A transactional manager uses one PostgreSQL connection; read in order on that connection.
  const courses = await manager.find(TrainingCourse, { where: { id: In(courseIds) } });
  const modules = await manager.find(TrainingModule, {
    where: { courseId: In(courseIds), isActive: true },
    order: { id: 'ASC' },
  });
  const criteria = await manager.find(TrainingCriterion, {
    where: { courseId: In(courseIds), isActive: true },
    order: { id: 'ASC' },
  });
  const rosters = await manager.find(TrainingSessionRoster, {
    where: { enrollmentId: In(enrollments.map((e) => e.id)), isActive: true },
    order: { id: 'ASC' },
  });
  const sessions = rosters.length
    ? await manager.find(TrainingSession, {
        where: { id: In(rosters.map((r) => r.sessionId)), status: 'COMPLETED' },
      })
    : [];
  const attendance = rosters.length
    ? await manager.find(TrainingAttendance, { where: { rosterId: In(rosters.map((r) => r.id)) } })
    : [];
  return new Map(
    enrollments.map((e) => {
      const required = modules.filter((m) => m.courseId === e.courseId && m.isRequired);
      const practical = criteria.filter((c) => c.courseId === e.courseId);
      const requiredPractical = practical.filter((c) => c.isRequired);
      const facts = rosters
        .filter((r) => r.enrollmentId === e.id)
        .flatMap((r) => {
          const s = sessions.find(
            (s) =>
              s.id === r.sessionId && s.endsAt <= at && required.some((m) => m.id === s.moduleId),
          );
          const a = attendance.find((a) => a.rosterId === r.id);
          return s && a
            ? [
                {
                  moduleId: s.moduleId,
                  sessionId: s.id,
                  attendanceId: a.id,
                  status: a.status,
                  attendedMinutes: a.attendedMinutes,
                  markedAt: a.markedAt.toISOString(),
                  reference: a.evidenceReference,
                },
              ]
            : [];
        })
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
      const moduleProgress = required.map((m) => {
        const minutes = facts
          .filter((f) => f.moduleId === m.id && f.status === 'PRESENT')
          .reduce((n, f) => n + f.attendedMinutes, 0);
        return {
          id: m.id,
          title: m.title,
          requiredMinutes: m.requiredMinutes,
          attendedMinutes: minutes,
          attendancePercent: m.requiredMinutes
            ? Math.min(100, Math.floor((minutes * 100) / m.requiredMinutes))
            : 0,
        };
      });
      const total = moduleProgress.reduce((n, m) => n + (m.requiredMinutes || 0), 0);
      const attended = moduleProgress.reduce(
        (n, m) => n + Math.min(m.attendedMinutes, m.requiredMinutes || 0),
        0,
      );
      const configured =
        required.length > 0 &&
        required.every((m) => !!m.requiredMinutes) &&
        requiredPractical.length > 0;
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            revision: courses.find((c) => c.id === e.courseId)?.requirementsRevision,
            modules: required.map((m) => ({ id: m.id, code: m.code, minutes: m.requiredMinutes })),
            criteria: practical.map((c) => ({
              id: c.id,
              code: c.code,
              serviceId: c.serviceId,
              minimum: c.minimumScore,
              required: c.isRequired,
            })),
            facts,
          }),
        )
        .digest('hex');
      return [
        e.id,
        {
          enrollmentId: e.id,
          courseId: e.courseId,
          courseActive: courses.some((c) => c.id === e.courseId && c.isActive),
          requirementsRevision: courses.find((c) => c.id === e.courseId)!.requirementsRevision,
          fingerprint,
          requirementsConfigured: configured,
          attendancePercent: total ? Math.floor((attended * 100) / total) : 0,
          attendanceReady: configured && moduleProgress.every((m) => m.attendancePercent >= 80),
          modules: moduleProgress,
          criteria: practical,
        },
      ];
    }),
  );
}
export async function currentCertificateEvidence(
  manager: EntityManager,
  certificates: ProviderCertificate[],
  at = new Date(),
): Promise<Set<string>> {
  if (!certificates.length) return new Set();
  const courses = await manager.find(TrainingCourse, {
    where: { code: In([...new Set(certificates.map((c) => c.courseCode))]) },
  });
  const enrollments = courses.length
    ? await manager.find(TrainingEnrollment, {
        where: {
          providerApplicationId: In([...new Set(certificates.map((c) => c.providerApplicationId))]),
          courseId: In(courses.map((c) => c.id)),
        },
      })
    : [];
  const ids = enrollments.flatMap((e) => (e.latestAssessmentId ? [e.latestAssessmentId] : []));
  const assessments = ids.length
    ? await manager.find(TrainingAssessment, { where: { id: In(ids) } })
    : [];
  const evidence = await trainingEvidenceBatch(manager, enrollments, at);
  return new Set(
    certificates
      .filter((c) => {
        if (c.revokedAt || !c.expiresAt || c.expiresAt <= at || !c.assessmentId) return false;
        const course = courses.find((course) => course.code === c.courseCode && course.isActive);
        const e = enrollments.find(
          (e) => e.providerApplicationId === c.providerApplicationId && e.courseId === course?.id,
        );
        const a = assessments.find(
          (a) =>
            a.id === e?.latestAssessmentId && a.id === c.assessmentId && a.enrollmentId === e?.id,
        );
        const current = e ? evidence.get(e.id) : null;
        return !!(
          e?.status === 'COMPLETED' &&
          e.assessmentPassed &&
          a?.passed &&
          a.validUntil > at &&
          c.expiresAt <= a.validUntil &&
          current?.attendanceReady &&
          current.courseActive &&
          current.fingerprint === a.evidenceFingerprint
        );
      })
      .map((c) => c.id),
  );
}
export async function currentEnrollmentEvidence(
  manager: EntityManager,
  enrollments: TrainingEnrollment[],
  at = new Date(),
): Promise<Map<string, { evidenceCurrent: boolean; currentAttendancePercent: number }>> {
  if (!enrollments.length) return new Map();
  const ids = enrollments.flatMap((e) => (e.latestAssessmentId ? [e.latestAssessmentId] : []));
  const evidence = await trainingEvidenceBatch(manager, enrollments, at);
  const assessments = ids.length
    ? await manager.find(TrainingAssessment, { where: { id: In(ids) } })
    : [];
  return new Map(
    enrollments.map((e) => {
      const current = evidence.get(e.id)!,
        a = assessments.find((a) => a.id === e.latestAssessmentId && a.enrollmentId === e.id);
      return [
        e.id,
        {
          currentAttendancePercent: current.attendancePercent,
          evidenceCurrent: !!(
            e.status === 'COMPLETED' &&
            e.assessmentPassed &&
            a?.passed &&
            a.validUntil > at &&
            current.courseActive &&
            current.attendanceReady &&
            current.fingerprint === a.evidenceFingerprint
          ),
        },
      ];
    }),
  );
}
