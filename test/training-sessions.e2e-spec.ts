/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- Supertest JSON response is untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { Role } from '../src/modules/identity/entities/role.entity';
import { User } from '../src/modules/identity/entities/user.entity';
import { UserRole } from '../src/modules/identity/entities/user-role.entity';
import { ProviderApplication } from '../src/modules/providers/entities/provider-application.entity';
import { TrainingEnrollment } from '../src/modules/providers/entities/training-enrollment.entity';
import { TrainingAssessment } from '../src/modules/providers/entities/training-assessment.entity';
import { TrainingSessionRoster } from '../src/modules/providers/entities/training-session-roster.entity';
import { AuditLog } from '../src/modules/identity/entities/audit-log.entity';
import { requireIsolatedDatabase } from './isolated-database';

describe('Independent training sessions/attendance in disposable database', () => {
  let app: INestApplication,
    db: DataSource,
    admin: string,
    adminId: string,
    instructorId: string,
    trainee: string,
    other: string,
    traineeId: string,
    applicationId: string,
    courseId: string,
    moduleId: string,
    foreignCourseId: string,
    foreignModuleId: string,
    enrollmentId: string,
    otherEnrollmentId: string,
    foreignEnrollmentId: string,
    selfEnrollmentId: string,
    sessionId: string;
  const suffix = randomUUID().slice(0, 8),
    password = randomBytes(32).toString('base64url') + '1!',
    reason = 'Disposable QA training evidence';
  const base = '/api/v1/admin/provider-training';
  const pastStart = new Date(Date.now() - 7200000).toISOString(),
    pastEnd = new Date(Date.now() - 3600000).toISOString();
  const api = (token?: string): ReturnType<typeof request.agent> => {
    const a = request.agent(app.getHttpServer()).set('Origin', 'http://localhost:3001');
    if (token) a.set('Authorization', 'Bearer ' + token);
    return a;
  };
  beforeAll(async () => {
    requireIsolatedDatabase();
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    const role = await db.getRepository(Role).findOneByOrFail({ name: 'SUPER_ADMIN' });
    for (const index of [1, 2]) {
      const u = await db.getRepository(User).save({
        email: `training-admin-${index}-${suffix}@mocmaria.test`,
        displayName: 'QA training admin ' + index,
        passwordHash: await argon2.hash(password),
        isActive: true,
      });
      await db.getRepository(UserRole).save({ userId: u.id, roleId: role.id });
      if (index === 1) {
        adminId = u.id;
        admin = (
          await api().post('/api/v1/auth/login').send({ identifier: u.email, password }).expect(200)
        ).body.accessToken;
      } else instructorId = u.id;
    }
    let otherApplicationId = '';
    for (const index of [1, 2]) {
      const a = await api()
        .post('/api/v1/auth/register')
        .send({
          email: `training-trainee-${index}-${suffix}@mocmaria.test`,
          displayName: 'QA trainee ' + index,
          password,
        })
        .expect(201);
      const token: string = a.body.accessToken;
      const p = await api(token)
        .post('/api/v1/provider-applications')
        .send({
          publicName: 'QA session trainee ' + index,
          introduction: 'Isolated training evidence',
          serviceArea: 'QA only',
        })
        .expect(201);
      await api(admin)
        .patch('/api/v1/admin/provider-applications/' + p.body.id + '/review')
        .send({ status: 'REVIEWING', note: reason })
        .expect(200);
      if (index === 1) {
        trainee = token;
        traineeId = a.body.user.id;
        applicationId = p.body.id;
      } else {
        other = token;
        otherApplicationId = p.body.id;
      }
    }
    courseId = (
      await api(admin)
        .post(base + '/courses')
        .send({ code: 'QA_SESSION_' + suffix.toUpperCase(), title: 'QA practical course only' })
        .expect(201)
    ).body.id;
    moduleId = (
      await api(admin)
        .post(base + `/courses/${courseId}/modules`)
        .send({
          code: 'PRACTICE',
          title: 'QA practical module',
          sortOrder: 0,
          isRequired: true,
          reason,
        })
        .expect(201)
    ).body.id;
    enrollmentId = (
      await api(admin)
        .post(base + '/enrollments')
        .send({ providerApplicationId: applicationId, courseId })
        .expect(201)
    ).body.id;
    otherEnrollmentId = (
      await api(admin)
        .post(base + '/enrollments')
        .send({ providerApplicationId: otherApplicationId, courseId })
        .expect(201)
    ).body.id;
    const foreignCourse = (
      await api(admin)
        .post(base + '/courses')
        .send({ code: 'QA_FOREIGN_' + suffix.toUpperCase(), title: 'QA other course' })
        .expect(201)
    ).body.id;
    foreignCourseId = foreignCourse;
    foreignModuleId = (
      await api(admin)
        .post(base + `/courses/${foreignCourseId}/modules`)
        .send({
          code: 'FOREIGN',
          title: 'QA second course module',
          sortOrder: 0,
          isRequired: true,
          reason,
        })
        .expect(201)
    ).body.id;
    foreignEnrollmentId = (
      await api(admin)
        .post(base + '/enrollments')
        .send({ providerApplicationId: otherApplicationId, courseId: foreignCourse })
        .expect(201)
    ).body.id;
    // Explicit disposable QA fixture exercises administrator self-attestation defenses.
    const own = await db
      .getRepository(ProviderApplication)
      .save({ userId: adminId, publicName: 'QA training self reviewer', status: 'TRAINING' });
    selfEnrollmentId = (
      await db.getRepository(TrainingEnrollment).save({
        providerApplicationId: own.id,
        courseId,
        status: 'ENROLLED',
        attendancePercent: 0,
        assessmentPassed: false,
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('protects program reads, validates instructor/timezone and rejects duplicate module', async () => {
    await api()
      .get(base + `/courses/${courseId}/program`)
      .expect(401);
    await api(trainee)
      .get(base + `/courses/${courseId}/program`)
      .expect(403);
    await api(admin)
      .get(base + `/courses/${courseId}/program`)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const body = {
      moduleId,
      instructorUserId: traineeId,
      startsAt: pastStart,
      endsAt: pastEnd,
      reason,
    };
    await api(admin)
      .post(base + `/courses/${courseId}/sessions`)
      .send(body)
      .expect(400);
    await api(admin)
      .post(base + `/courses/${courseId}/sessions`)
      .send({ ...body, instructorUserId: adminId, startsAt: '2026-10-09T09:00:00' })
      .expect(400);
    await api(admin)
      .post(base + `/courses/${courseId}/modules`)
      .send({ code: 'PRACTICE', title: 'Duplicate code', sortOrder: 1, isRequired: true, reason })
      .expect(409);
  });
  it('serializes instructor scheduling against concurrent overlap', async () => {
    const body = {
      moduleId,
      instructorUserId: adminId,
      startsAt: pastStart,
      endsAt: pastEnd,
      reason,
    };
    const results = await Promise.all([
      api(admin)
        .post(base + `/courses/${courseId}/sessions`)
        .send(body),
      api(admin)
        .post(base + `/courses/${courseId}/sessions`)
        .send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    sessionId = results.find((r) => r.status === 201)!.body.id;
    await api(admin)
      .post(base + `/courses/${courseId}/sessions`)
      .send({ ...body, endsAt: new Date(Date.parse(pastStart) + 9 * 3600000).toISOString() })
      .expect(400);
  });
  it('registers matching enrollment before closure and blocks self attendance', async () => {
    const dto = { sessionId, isActive: true, reason };
    await api(trainee)
      .post(base + `/enrollments/${enrollmentId}/sessions`)
      .send(dto)
      .expect(403);
    await api(admin)
      .post(base + `/enrollments/${foreignEnrollmentId}/sessions`)
      .send(dto)
      .expect(400);
    await api(admin)
      .post(base + `/enrollments/${selfEnrollmentId}/sessions`)
      .send(dto)
      .expect(400);
    await api(admin)
      .post(base + `/enrollments/${enrollmentId}/sessions`)
      .send(dto)
      .expect(201);
    const attendance = {
      status: 'PRESENT',
      attendedMinutes: 60,
      evidenceReference: 'QA_ATTENDANCE_001',
      attendanceConfirmed: true,
      reason,
    };
    await api(admin)
      .post(base + `/enrollments/${enrollmentId}/sessions/${sessionId}/attendance`)
      .send(attendance)
      .expect(400);
    await api(admin)
      .post(base + `/enrollments/${selfEnrollmentId}/sessions/${sessionId}/attendance`)
      .send(attendance)
      .expect(400);
    await api(admin)
      .patch(base + `/sessions/${sessionId}/state`)
      .send({ status: 'COMPLETED', recordConfirmed: true, reason })
      .expect(400);
    await api(admin)
      .patch(base + `/sessions/${sessionId}/state`)
      .send({
        status: 'COMPLETED',
        completionReference: 'QA_COMPLETION_001',
        recordConfirmed: true,
        reason,
      })
      .expect(200);
    await api(admin)
      .post(base + `/enrollments/${otherEnrollmentId}/sessions`)
      .send(dto)
      .expect(400);
  });
  it('bounds attendance duration, audits corrections and isolates owned sessions', async () => {
    const url = base + `/enrollments/${enrollmentId}/sessions/${sessionId}/attendance`;
    const dto = {
      status: 'PRESENT',
      attendedMinutes: 48,
      evidenceReference: 'QA_ATTENDANCE_PRIVATE',
      attendanceConfirmed: true,
      reason,
    };
    await api(admin)
      .post(url)
      .send({ ...dto, attendedMinutes: 61 })
      .expect(400);
    await api(admin)
      .post(url)
      .send({ ...dto, status: 'ABSENT', attendedMinutes: 1 })
      .expect(400);
    await api(admin)
      .post(url)
      .send({ ...dto, attendanceConfirmed: false })
      .expect(400);
    await api(admin).post(url).send(dto).expect(201);
    const own = await api(trainee)
      .get('/api/v1/provider-applications/me/training-sessions')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(own.body[0].records[0].attendance.attendedMinutes).toBe(48);
    expect(JSON.stringify(own.body)).not.toContain('QA_ATTENDANCE_PRIVATE');
    expect(JSON.stringify(own.body)).not.toContain(adminId);
    const unrelated = await api(other)
      .get('/api/v1/provider-applications/me/training-sessions')
      .expect(200);
    const unrelatedRecords: Array<{ records: unknown[] }> = unrelated.body;
    expect(unrelatedRecords.every((r) => r.records.length === 0)).toBe(true);
    await api(admin)
      .post(url)
      .send({ ...dto, status: 'EXCUSED', attendedMinutes: 0 })
      .expect(201);
    const history = await db
      .getRepository(AuditLog)
      .find({ where: { event: 'provider.training.attendance_recorded', targetUserId: traineeId } });
    expect(history).toHaveLength(2);
    expect(history.some((h) => h.metadata?.['previous'])).toBe(true);
    const recorded = await api(admin)
      .get(base + `/enrollments/${enrollmentId}/sessions`)
      .expect(200);
    expect(recorded.body.records[0].attendance.history).toHaveLength(2);
    const recordedHistory: Array<{ status: string }> = recorded.body.records[0].attendance.history;
    expect(recordedHistory.map((h) => h.status)).toEqual(['PRESENT', 'EXCUSED']);
    await api(admin)
      .post(url)
      .send({ ...dto, attendedMinutes: 60 })
      .expect(201);
  });
  it('blocks trainee overlap/future completion/self closure and releases cancelled sessions', async () => {
    const foreignSession = (
      await api(admin)
        .post(base + `/courses/${foreignCourseId}/sessions`)
        .send({
          moduleId: foreignModuleId,
          instructorUserId: instructorId,
          startsAt: pastStart,
          endsAt: pastEnd,
          reason,
        })
        .expect(201)
    ).body.id;
    const anotherEnrollment = (
      await api(admin)
        .post(base + '/enrollments')
        .send({ providerApplicationId: applicationId, courseId: foreignCourseId })
        .expect(201)
    ).body.id;
    await api(admin)
      .post(base + `/enrollments/${anotherEnrollment}/sessions`)
      .send({ sessionId: foreignSession, isActive: true, reason })
      .expect(409);
    await api(admin)
      .patch(base + `/sessions/${foreignSession}/state`)
      .send({ status: 'CANCELLED', recordConfirmed: true, reason })
      .expect(200);
    const secondModule = (
      await api(admin)
        .post(base + `/courses/${courseId}/modules`)
        .send({ code: 'OTHER', title: 'QA other module', sortOrder: 1, isRequired: false, reason })
        .expect(201)
    ).body.id;
    const overlap = (
      await api(admin)
        .post(base + `/courses/${courseId}/sessions`)
        .send({
          moduleId: secondModule,
          instructorUserId: instructorId,
          startsAt: pastStart,
          endsAt: pastEnd,
          reason,
        })
        .expect(201)
    ).body.id;
    await api(admin)
      .post(base + `/enrollments/${enrollmentId}/sessions`)
      .send({ sessionId: overlap, isActive: true, reason })
      .expect(409);
    await db.getRepository(TrainingSessionRoster).save({
      sessionId: overlap,
      enrollmentId: selfEnrollmentId,
      isActive: true,
      addedBy: instructorId,
    });
    await api(admin)
      .patch(base + `/sessions/${overlap}/state`)
      .send({
        status: 'COMPLETED',
        completionReference: 'QA_SELF_CLOSURE',
        recordConfirmed: true,
        reason,
      })
      .expect(400);
    const future = {
      moduleId: secondModule,
      instructorUserId: adminId,
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
      reason,
    };
    const id = (
      await api(admin)
        .post(base + `/courses/${courseId}/sessions`)
        .send(future)
        .expect(201)
    ).body.id;
    await api(admin)
      .patch(base + `/sessions/${id}/state`)
      .send({
        status: 'COMPLETED',
        completionReference: 'QA_FUTURE',
        recordConfirmed: true,
        reason,
      })
      .expect(400);
    await api(admin)
      .patch(base + `/sessions/${id}/state`)
      .send({ status: 'CANCELLED', recordConfirmed: true, reason })
      .expect(200);
    await api(admin)
      .post(base + `/courses/${courseId}/sessions`)
      .send(future)
      .expect(201);
  });
  it('also prevents concurrent instructor collisions across different courses', async () => {
    const startsAt = new Date(Date.now() - 4 * 86400000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
    const results = await Promise.all([
      api(admin)
        .post(base + `/courses/${courseId}/sessions`)
        .send({ moduleId, instructorUserId: adminId, startsAt, endsAt, reason }),
      api(admin)
        .post(base + `/courses/${foreignCourseId}/sessions`)
        .send({ moduleId: foreignModuleId, instructorUserId: adminId, startsAt, endsAt, reason }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  let criterionId: string, detailedCertificateId: string, firstNumber: string;
  const assessmentPath = (): string => base + `/enrollments/${enrollmentId}/assessments`;
  const assessBody = (score = 95): Record<string, unknown> => ({
    scores: [{ criterionId, score }],
    evidenceReference: 'QA_DETAILED_PRACTICAL',
    validUntil: new Date(Date.now() + 2592000000).toISOString(),
    practicalConfirmed: true,
    reason,
  });
  const issueBody = (number: string): Record<string, unknown> => ({
    courseCode: 'QA_SESSION_' + suffix.toUpperCase(),
    title: 'ignored client title',
    certificateNumber: number,
    expiresAt: new Date(Date.now() + 604800000).toISOString(),
    issuedConfirmed: true,
    reason,
  });
  const renewPath = (): string =>
    `/api/v1/admin/provider-applications/${applicationId}/certificates/${detailedCertificateId}/renew`;
  it('requires explicit module volume and real practical criteria before detailed assessment', async () => {
    await api(admin)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'TRAINING', note: reason })
      .expect(200);
    await api(admin)
      .post(assessmentPath())
      .send({ ...assessBody(), scores: [{ criterionId: randomUUID(), score: 100 }] })
      .expect(400);
    await api(admin)
      .patch(base + `/courses/${courseId}/modules/${moduleId}/requirements`)
      .send({
        requiredMinutes: 60,
        isRequired: true,
        isActive: true,
        requirementsConfirmed: false,
        reason,
      })
      .expect(400);
    await api(admin)
      .patch(base + `/courses/${courseId}/modules/${moduleId}/requirements`)
      .send({
        requiredMinutes: 60,
        isRequired: true,
        isActive: true,
        requirementsConfirmed: true,
        reason,
      })
      .expect(200);
    criterionId = (
      await api(admin)
        .post(base + `/courses/${courseId}/criteria`)
        .send({
          code: 'PRACTICAL',
          title: 'QA observed practice',
          minimumScore: 80,
          isRequired: true,
          isActive: true,
          criteriaConfirmed: true,
          reason,
        })
        .expect(201)
    ).body.id;
    await api(admin)
      .patch(base + `/courses/${foreignCourseId}/criteria/${criterionId}`)
      .send({
        code: 'PRACTICAL',
        title: 'QA wrong course',
        minimumScore: 80,
        isRequired: true,
        isActive: true,
        criteriaConfirmed: true,
        reason,
      })
      .expect(404);
    await api().get(assessmentPath()).expect(401);
    await api(trainee).get(assessmentPath()).expect(403);
    await api(trainee).post(assessmentPath()).send(assessBody()).expect(403);
    await api(admin)
      .post(base + `/enrollments/${selfEnrollmentId}/assessments`)
      .send(assessBody())
      .expect(400);
  });
  it('rejects fabricated percentages/criteria/confirmation and preserves failed and passed attempts', async () => {
    await api(admin)
      .post(assessmentPath())
      .send({ ...assessBody(), attendancePercent: 100 })
      .expect(400);
    await api(admin)
      .post(assessmentPath())
      .send({
        ...assessBody(),
        scores: [
          { criterionId, score: 100 },
          { criterionId, score: 100 },
        ],
      })
      .expect(400);
    await api(admin)
      .post(assessmentPath())
      .send({ ...assessBody(), scores: [{ criterionId: randomUUID(), score: 100 }] })
      .expect(400);
    await api(admin)
      .post(assessmentPath())
      .send({ ...assessBody(), practicalConfirmed: false })
      .expect(400);
    const failed = await api(admin).post(assessmentPath()).send(assessBody(50)).expect(201);
    expect(failed.body.attendancePercent).toBe(100);
    expect(failed.body.assessmentPassed).toBe(false);
    const passed = await api(admin).post(assessmentPath()).send(assessBody()).expect(201);
    expect(passed.body.assessmentPassed).toBe(true);
    const view = await api(admin).get(assessmentPath()).expect(200);
    expect(view.headers['cache-control']).toBe('private, no-store');
    expect(view.body.history).toHaveLength(2);
    expect(view.body.history[0].snapshot.requirementsRevision).toBeGreaterThan(1);
    expect(view.body.evidenceCurrent).toBe(true);
    firstNumber = 'QA_DETAIL_' + suffix.toUpperCase();
    await api(admin)
      .post(`/api/v1/admin/provider-applications/${applicationId}/certificates`)
      .send({
        ...issueBody(firstNumber),
        expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
      })
      .expect(400);
    const certificate = await api(admin)
      .post(`/api/v1/admin/provider-applications/${applicationId}/certificates`)
      .send(issueBody(firstNumber))
      .expect(201);
    detailedCertificateId = certificate.body.id;
    const own = await api(trainee).get('/api/v1/provider-applications/me/training').expect(200);
    expect(own.body.certificates[0].isValid).toBe(true);
    expect(JSON.stringify(own.body)).not.toContain('QA_DETAILED_PRACTICAL');
  });
  it('invalidates a certificate after changing and restoring criteria; renewal requires fresh assessment', async () => {
    const criterion = (minimumScore: number): Record<string, unknown> => ({
      code: 'PRACTICAL',
      title: 'QA observed practice',
      minimumScore,
      isRequired: true,
      isActive: true,
      criteriaConfirmed: true,
      reason,
    });
    await api(admin)
      .post(renewPath())
      .send(issueBody(firstNumber + '_EARLY'))
      .expect(400);
    await api(admin)
      .patch(base + `/courses/${courseId}/criteria/${criterionId}`)
      .send(criterion(80))
      .expect(200);
    const unchanged = await api(trainee)
      .get('/api/v1/provider-applications/me/training')
      .expect(200);
    expect(unchanged.body.certificates[0].isValid).toBe(true);
    await api(admin)
      .patch(base + `/courses/${courseId}/criteria/${criterionId}`)
      .send(criterion(90))
      .expect(200);
    await api(admin)
      .patch(base + `/courses/${courseId}/criteria/${criterionId}`)
      .send(criterion(80))
      .expect(200);
    const invalid = await api(trainee).get('/api/v1/provider-applications/me/training').expect(200);
    expect(invalid.body.certificates[0].isValid).toBe(false);
    await api(admin)
      .post(renewPath())
      .send(issueBody(firstNumber + '_STALE'))
      .expect(400);
    await api(admin).post(assessmentPath()).send(assessBody()).expect(201);
    await api(admin).post(renewPath()).send(issueBody(firstNumber)).expect(409);
    const renewed = await api(admin)
      .post(renewPath())
      .send(issueBody(firstNumber + '_R1'))
      .expect(201);
    expect(renewed.body.id).toBe(detailedCertificateId);
    await api().get(renewPath().replace('/renew', '/history')).expect(401);
    await api(trainee).get(renewPath().replace('/renew', '/history')).expect(403);
    const history = await api(admin).get(renewPath().replace('/renew', '/history')).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[0].certificateNumber).toBe(firstNumber);
    expect(history.body[1].kind).toBe('RENEWED');
  });
  it('derives module attendance and invalidates prior evidence after corrections, without a manual bypass', async () => {
    const attendancePath = base + `/enrollments/${enrollmentId}/sessions/${sessionId}/attendance`;
    const attendance = (minutes: number): Record<string, unknown> => ({
      status: 'PRESENT',
      attendedMinutes: minutes,
      evidenceReference: 'QA_ATTENDANCE_REASSESS',
      attendanceConfirmed: true,
      reason,
    });
    await api(admin).post(attendancePath).send(attendance(45)).expect(201);
    const own = await api(trainee).get('/api/v1/provider-applications/me/training').expect(200);
    expect(own.body.certificates[0].isValid).toBe(false);
    await api(admin)
      .patch(base + `/enrollments/${enrollmentId}/assessment`)
      .send({ attendancePercent: 100, assessmentPassed: true })
      .expect(400);
    const failed = await api(admin).post(assessmentPath()).send(assessBody()).expect(201);
    expect(failed.body.attendancePercent).toBe(75);
    expect(failed.body.assessmentPassed).toBe(false);
    await api(admin)
      .post(renewPath())
      .send(issueBody(firstNumber + '_FAIL'))
      .expect(400);
    await api(admin).post(attendancePath).send(attendance(60)).expect(201);
    await api(admin).post(assessmentPath()).send(assessBody()).expect(201);
    const results = await Promise.all([
      api(admin)
        .post(renewPath())
        .send(issueBody(firstNumber + '_R2A')),
      api(admin)
        .post(renewPath())
        .send(issueBody(firstNumber + '_R2B')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const history = await api(admin).get(renewPath().replace('/renew', '/history')).expect(200);
    expect(history.body).toHaveLength(3);
  });
  it('expires assessment evidence and requires post-revocation reassessment without automatic approval', async () => {
    const current = await db
      .getRepository(TrainingEnrollment)
      .findOneByOrFail({ id: enrollmentId });
    await db
      .getRepository(TrainingAssessment)
      .update(current.latestAssessmentId!, { validUntil: new Date(Date.now() - 1000) });
    const expired = await api(trainee).get('/api/v1/provider-applications/me/training').expect(200);
    expect(expired.body.certificates[0].isValid).toBe(false);
    await api(admin)
      .post(renewPath())
      .send(issueBody(firstNumber + '_EXP'))
      .expect(400);
    await api(admin).patch(renewPath().replace('/renew', '/revoke')).expect(200);
    await api(admin).post(assessmentPath()).send(assessBody()).expect(201);
    await api(admin)
      .post(renewPath())
      .send(issueBody(firstNumber + '_REVOKED'))
      .expect(400);
    await api(admin)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'ASSESSMENT', note: reason })
      .expect(200);
    const restored = await api(admin)
      .post(renewPath())
      .send(issueBody(firstNumber + '_R3'))
      .expect(201);
    expect(restored.body.id).toBe(detailedCertificateId);
    const application = await db
      .getRepository(ProviderApplication)
      .findOneByOrFail({ id: applicationId });
    expect(application.status).toBe('ASSESSMENT');
  });
});
