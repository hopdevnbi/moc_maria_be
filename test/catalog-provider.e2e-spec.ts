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
import { StaffProfile } from '../src/modules/identity/entities/staff-profile.entity';
import { ProviderCertificate } from '../src/modules/providers/entities/provider-certificate.entity';
import { AuditLog } from '../src/modules/identity/entities/audit-log.entity';
import { ServiceProviderPolicy } from '../src/modules/providers/entities/service-provider-policy.entity';
import { ProviderServiceGrant } from '../src/modules/providers/entities/provider-service-grant.entity';
import { Branch } from '../src/modules/catalog/entities/branch.entity';
import { requireIsolatedDatabase } from './isolated-database';

describe('Catalog and provider lifecycle in isolated database', () => {
  let app: INestApplication;
  let database: DataSource;
  let admin: string;
  let adminUserId: string;
  let applicant: string;
  let otherCustomer: string;
  let applicantUserId: string;
  let applicationId: string;
  let serviceId: string;
  let categoryId: string;
  let variantId: string;
  let enrollmentId: string;
  let certificateId: string;
  let branchId: string;
  let courseId: string;
  let selfApplicationId: string;
  const suffix = randomUUID();
  const slug = 'qa-care-' + suffix;
  const password = randomBytes(32).toString('base64url') + '1!';
  const courseCode = 'QA_' + suffix.slice(0, 8).toUpperCase();
  const certificateNumber = 'QA_CERT_' + suffix.slice(0, 8).toUpperCase();

  function api(token?: string): ReturnType<typeof request.agent> {
    const agent = request.agent(app.getHttpServer()).set('Origin', 'http://localhost:3001');
    if (token) agent.set('Authorization', 'Bearer ' + token);
    return agent;
  }

  beforeAll(async () => {
    requireIsolatedDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DataSource);
    const role = await database.getRepository(Role).findOneByOrFail({ name: 'SUPER_ADMIN' });
    const user = await database.getRepository(User).save({
      email: `admin-${suffix}@mocmaria.test`,
      displayName: 'QA administrator',
      isActive: true,
      passwordHash: await argon2.hash(password),
    });
    await database.getRepository(UserRole).save({ userId: user.id, roleId: role.id });
    adminUserId = user.id;
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password })
      .expect(200);
    admin = login.body.accessToken;
    const first = await api()
      .post('/api/v1/auth/register')
      .send({ email: `applicant-${suffix}@mocmaria.test`, displayName: 'QA applicant', password })
      .expect(201);
    applicant = first.body.accessToken;
    applicantUserId = first.body.user.id;
    const second = await api()
      .post('/api/v1/auth/register')
      .send({ email: `other-${suffix}@mocmaria.test`, displayName: 'QA other customer', password })
      .expect(201);
    otherCustomer = second.body.accessToken;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('publishes only published categories/services and active variants with live prices', async () => {
    const category = await api(admin)
      .post('/api/v1/admin/service-categories')
      .send({ name: 'QA only category', slug: 'qa-category-' + suffix, isPublished: false })
      .expect(201);
    categoryId = category.body.id;
    const service = await api(admin)
      .post('/api/v1/admin/services')
      .send({ categoryId, name: 'QA only service', slug, isPublished: false })
      .expect(201);
    serviceId = service.body.id;
    const variant = await api(admin)
      .post(`/api/v1/admin/services/${serviceId}/variants`)
      .send({ name: 'QA only variant', durationMinutes: 60, priceVnd: 123456 })
      .expect(201);
    variantId = variant.body.id;
    await api()
      .get('/api/v1/services/' + slug)
      .expect(404);
    await api(admin)
      .patch(`/api/v1/admin/services/${serviceId}`)
      .send({ isPublished: true })
      .expect(200);
    await api()
      .get('/api/v1/services/' + slug)
      .expect(404);
    await api(admin)
      .patch(`/api/v1/admin/service-categories/${categoryId}`)
      .send({ isPublished: true })
      .expect(200);
    let detail = await api()
      .get('/api/v1/services/' + slug)
      .expect(200);
    expect(detail.body.variants[0].priceVnd).toBe('123456');
    await api(admin)
      .patch(`/api/v1/admin/services/${serviceId}/variants/${variantId}`)
      .send({ priceVnd: 234567 })
      .expect(200);
    detail = await api()
      .get('/api/v1/services/' + slug)
      .expect(200);
    expect(detail.body.variants[0].priceVnd).toBe('234567');
    await api(admin)
      .patch(`/api/v1/admin/services/${serviceId}/variants/${variantId}`)
      .send({ isActive: false })
      .expect(200);
    detail = await api()
      .get('/api/v1/services/' + slug)
      .expect(200);
    expect(detail.body.variants).toEqual([]);
  });

  it('rejects invalid prices, cross-service variant edits and customer admin writes', async () => {
    await api(admin)
      .patch(`/api/v1/admin/services/${serviceId}/variants/${variantId}`)
      .send({ priceVnd: -1 })
      .expect(400);
    await api(admin)
      .patch(`/api/v1/admin/services/${randomUUID()}/variants/${variantId}`)
      .send({ priceVnd: 1 })
      .expect(404);
    await api(applicant)
      .patch(`/api/v1/admin/services/${serviceId}`)
      .send({ isPublished: true })
      .expect(403);
    await api()
      .get('/api/v1/services/' + encodeURIComponent("' OR 1=1 --"))
      .expect(404);
  });

  it('manages branch hours, dated closures, resources and service mappings without exposing inactive branches', async () => {
    const branch = await api(admin)
      .post('/api/v1/admin/branches')
      .send({
        name: 'QA only branch',
        code: 'qa-' + suffix,
        address: 'Isolated QA address only',
        isActive: false,
      })
      .expect(201);
    const id: string = branch.body.id;
    branchId = id;
    await api().get(`/api/v1/branches/${id}/hours`).expect(404);
    await api(admin)
      .put(`/api/v1/admin/branches/${id}/hours`)
      .send({ hours: [{ weekday: 1, opensAtMinute: 540, closesAtMinute: 1080 }] })
      .expect(200);
    const hours = await api(admin).get(`/api/v1/admin/branches/${id}/hours`).expect(200);
    expect(hours.body).toHaveLength(1);
    await api(admin)
      .put(`/api/v1/admin/branches/${id}/hours`)
      .send({ hours: [{ weekday: 1, opensAtMinute: 1080, closesAtMinute: 540 }] })
      .expect(400);
    await api(admin)
      .put(`/api/v1/admin/branches/${id}/exceptions`)
      .send({ date: '2026-12-25', isClosed: true })
      .expect(200);
    const exceptions = await api(admin).get(`/api/v1/admin/branches/${id}/exceptions`).expect(200);
    expect(exceptions.body[0].isClosed).toBe(true);
    await api(admin)
      .post(`/api/v1/admin/branches/${id}/resources`)
      .send({ code: 'qa-room', name: 'QA only room', kind: 'ROOM', capacity: 1 })
      .expect(201);
    const resources = await api(admin).get(`/api/v1/admin/branches/${id}/resources`).expect(200);
    expect(resources.body).toHaveLength(1);
    await api(admin)
      .post(`/api/v1/admin/branches/${id}/services`)
      .send({ serviceId, isActive: true })
      .expect(201);
    const mapping = await api(admin).get(`/api/v1/admin/branches/${id}/services`).expect(200);
    expect(mapping.body[0].serviceId).toBe(serviceId);
    let detail = await api()
      .get('/api/v1/services/' + slug)
      .expect(200);
    expect(detail.body.branches).toEqual([]);
    await api(admin).patch(`/api/v1/admin/branches/${id}`).send({ isActive: true }).expect(200);
    detail = await api()
      .get('/api/v1/services/' + slug)
      .expect(200);
    expect(detail.body.branches[0].branch.id).toBe(id);
    await api(applicant).get(`/api/v1/admin/branches/${id}/hours`).expect(403);
    await api(applicant).get(`/api/v1/admin/branches/${id}/services`).expect(403);
  });

  it('creates exactly one application, prevents status forgery and isolates applicant data', async () => {
    await api(applicant)
      .post('/api/v1/provider-applications')
      .send({ publicName: 'QA provider', status: 'APPROVED' })
      .expect(400);
    const applied = await api(applicant)
      .post('/api/v1/provider-applications')
      .send({
        publicName: 'QA provider',
        introduction: 'Isolated QA fixture only',
        serviceArea: 'QA area only',
      })
      .expect(201);
    applicationId = applied.body.id;
    await api(otherCustomer)
      .patch('/api/v1/provider-applications/me')
      .send({ publicName: 'Other QA', introduction: 'QA', serviceArea: 'QA' })
      .expect(404);
    await api(applicant)
      .patch('/api/v1/provider-applications/me')
      .send({
        publicName: 'QA provider',
        introduction: 'QA',
        serviceArea: 'QA',
        status: 'APPROVED',
      })
      .expect(400);
    await api(applicant)
      .patch('/api/v1/provider-applications/me')
      .send({
        publicName: 'QA provider',
        introduction: 'Isolated QA fixture only',
        serviceArea: 'QA area only',
      })
      .expect(200);

    expect(applied.body.status).toBe('APPLIED');
    await api(applicant)
      .post('/api/v1/provider-applications')
      .send({ publicName: 'QA provider' })
      .expect(409);
    const other = await api(otherCustomer).get('/api/v1/provider-applications/me').expect(200);
    expect(other.text).toBe('');
    const training = await api(otherCustomer)
      .get('/api/v1/provider-applications/me/training')
      .expect(200);
    expect(training.body).toEqual({ enrollments: [], certificates: [] });
    await api(otherCustomer)
      .get(`/api/v1/admin/provider-applications/${applicationId}/training`)
      .expect(403);
    await api(applicant)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'APPROVED', note: 'Isolated QA decision' })
      .expect(403);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
  });

  it('requires reviewed application, real training completion and practical assessment before certification', async () => {
    await api(admin)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'APPROVED', note: 'Isolated QA decision' })
      .expect(400);
    await api(admin)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'REVIEWING', note: 'Isolated QA decision' })
      .expect(200);
    const course = await api(admin)
      .post('/api/v1/admin/provider-training/courses')
      .send({ code: courseCode, title: 'QA internal training only' })
      .expect(201);
    courseId = course.body.id;
    const enrollment = await api(admin)
      .post('/api/v1/admin/provider-training/enrollments')
      .send({ courseId: course.body.id, providerApplicationId: applicationId })
      .expect(201);
    enrollmentId = enrollment.body.id;
    await api(admin)
      .post(`/api/v1/admin/provider-applications/${applicationId}/certificates`)
      .send({ courseCode, title: 'ignored client title', certificateNumber })
      .expect(400);
    await api(admin)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'TRAINING', note: 'Isolated QA decision' })
      .expect(200);
    await api(admin)
      .patch(`/api/v1/admin/provider-training/enrollments/${enrollmentId}/assessment`)
      .send({ attendancePercent: 60, assessmentPassed: true })
      .expect(400);
    const base = '/api/v1/admin/provider-training';
    const reason = 'Disposable QA detailed training evidence';
    const moduleId: string = (
      await api(admin)
        .post(base + `/courses/${courseId}/modules`)
        .send({
          code: 'REQUIRED',
          title: 'QA required practice',
          sortOrder: 0,
          isRequired: true,
          reason,
        })
        .expect(201)
    ).body.id;
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
    const criterionId: string = (
      await api(admin)
        .post(base + `/courses/${courseId}/criteria`)
        .send({
          code: 'SERVICE_PRACTICE',
          title: 'QA service practical criterion',
          serviceId,
          minimumScore: 80,
          isRequired: true,
          isActive: true,
          criteriaConfirmed: true,
          reason,
        })
        .expect(201)
    ).body.id;
    const sessionId: string = (
      await api(admin)
        .post(base + `/courses/${courseId}/sessions`)
        .send({
          moduleId,
          instructorUserId: adminUserId,
          startsAt: new Date(Date.now() - 10800000).toISOString(),
          endsAt: new Date(Date.now() - 7200000).toISOString(),
          reason,
        })
        .expect(201)
    ).body.id;
    await api(admin)
      .post(base + `/enrollments/${enrollmentId}/sessions`)
      .send({ sessionId, isActive: true, reason })
      .expect(201);
    await api(admin)
      .patch(base + `/sessions/${sessionId}/state`)
      .send({
        status: 'COMPLETED',
        completionReference: 'QA_CLASS_COMPLETE',
        recordConfirmed: true,
        reason,
      })
      .expect(200);
    const attendancePath = base + `/enrollments/${enrollmentId}/sessions/${sessionId}/attendance`;
    await api(admin)
      .post(attendancePath)
      .send({
        status: 'PRESENT',
        attendedMinutes: 36,
        evidenceReference: 'QA_ATTENDANCE',
        attendanceConfirmed: true,
        reason,
      })
      .expect(201);
    const assessmentBody = {
      scores: [{ criterionId, score: 95 }],
      evidenceReference: 'QA_PRACTICAL_REVIEW',
      validUntil: new Date(Date.now() + 2592000000).toISOString(),
      practicalConfirmed: true,
      reason,
    };
    const failed = await api(admin)
      .post(base + `/enrollments/${enrollmentId}/assessments`)
      .send(assessmentBody)
      .expect(201);
    expect(failed.body.attendancePercent).toBe(60);
    expect(failed.body.assessmentPassed).toBe(false);
    const certificateBody = {
      courseCode,
      title: 'ignored client title',
      certificateNumber,
      expiresAt: new Date(Date.now() + 604800000).toISOString(),
      issuedConfirmed: true,
      reason,
    };
    await api(admin)
      .post(`/api/v1/admin/provider-applications/${applicationId}/certificates`)
      .send(certificateBody)
      .expect(400);
    await api(applicant)
      .post(base + `/enrollments/${enrollmentId}/assessments`)
      .send(assessmentBody)
      .expect(403);
    await api(admin)
      .post(attendancePath)
      .send({
        status: 'PRESENT',
        attendedMinutes: 60,
        evidenceReference: 'QA_ATTENDANCE',
        attendanceConfirmed: true,
        reason,
      })
      .expect(201);
    await api(admin)
      .post(base + `/enrollments/${enrollmentId}/assessments`)
      .send(assessmentBody)
      .expect(201);
    const cert = await api(admin)
      .post(`/api/v1/admin/provider-applications/${applicationId}/certificates`)
      .send(certificateBody)
      .expect(201);
    certificateId = cert.body.id;
    expect(cert.body.title).toBe('QA internal training only');
    const own = await api(applicant).get('/api/v1/provider-applications/me/training').expect(200);
    expect(own.body.certificates[0].isValid).toBe(true);
    expect(own.body.certificates[0].issuedBy).toBeUndefined();
    expect(own.body.enrollments[0].enrollment.assessedBy).toBeUndefined();
  });

  it('requires explicit versioned consent and verified current contact, without exposing private evidence', async () => {
    await api(admin)
      .patch('/api/v1/admin/provider-applications/' + applicationId + '/review')
      .send({ status: 'ASSESSMENT', note: 'QA assessment ready' })
      .expect(200);
    await api(admin)
      .patch('/api/v1/admin/provider-applications/' + applicationId + '/review')
      .send({ status: 'APPROVED', note: 'QA approval must fail' })
      .expect(400);
    await api(admin)
      .patch('/api/v1/admin/provider-applications/' + applicationId + '/review')
      .send({ status: 'TRAINING', note: 'QA return to training' })
      .expect(200);

    const selfApplication = await api(admin)
      .post('/api/v1/provider-applications')
      .send({ publicName: 'QA self reviewer', applicationConsentVersion: 'provider-consent-v1' })
      .expect(201);
    selfApplicationId = selfApplication.body.id;
    await api(admin)
      .post(
        '/api/v1/admin/provider-applications/' + selfApplication.body.id + '/contact-verifications',
      )
      .send({
        channel: 'EMAIL',
        contactValue: 'admin-' + suffix + '@mocmaria.test',
        evidenceReference: 'QA_SELF',
        confirmedByContact: true,
      })
      .expect(400);
    await api(admin)
      .patch('/api/v1/admin/provider-applications/' + selfApplication.body.id + '/review')
      .send({ status: 'REVIEWING', note: 'QA forbidden self decision' })
      .expect(400);
    const ownPath = '/api/v1/provider-applications/me/eligibility';
    const adminPath = '/api/v1/admin/provider-applications/' + applicationId;
    let own = await api(applicant)
      .get(ownPath)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(own.body.applicationConsent).toBe(false);
    expect(own.body.contactVerified).toBe(false);
    await api(otherCustomer)
      .post(adminPath + '/contact-verifications')
      .send({})
      .expect(403);
    await api(applicant)
      .post('/api/v1/provider-applications/me/consent')
      .send({ scope: 'APPLICATION_REVIEW', version: 'forged', granted: true })
      .expect(400);
    for (const scope of ['APPLICATION_REVIEW', 'PUBLIC_PROFILE']) {
      await api(applicant)
        .post('/api/v1/provider-applications/me/consent')
        .send({ scope, version: 'provider-consent-v1', granted: true })
        .expect(201);
    }
    const contactValue = 'applicant-' + suffix + '@mocmaria.test';
    const verification = {
      channel: 'EMAIL',
      contactValue,
      evidenceReference: 'QA_CONTACT_001',
      confirmedByContact: true,
    };
    await api(admin)
      .post(adminPath + '/contact-verifications')
      .send({ ...verification, confirmedByContact: false })
      .expect(400);
    await api(admin)
      .post(adminPath + '/contact-verifications')
      .send({ ...verification, contactValue: 'wrong@mocmaria.test' })
      .expect(400);
    await api(admin)
      .post(adminPath + '/contact-verifications')
      .send(verification)
      .expect(201);
    own = await api(applicant).get(ownPath).expect(200);
    expect(own.body.reviewReady).toBe(true);
    expect(own.body.bookable).toBe(false);
    expect(own.body.contacts[0].contactHash).toBeUndefined();
    expect(own.body.contacts[0].evidenceReference).toBeUndefined();
    expect(own.body.contacts[0].verifiedBy).toBeUndefined();
    await api(applicant)
      .patch('/api/v1/customers/me')
      .send({ email: 'changed-' + suffix + '@mocmaria.test' })
      .expect(200);
    own = await api(applicant).get(ownPath).expect(200);
    expect(own.body.contactVerified).toBe(false);
    await api(applicant).patch('/api/v1/customers/me').send({ email: contactValue }).expect(200);
    own = await api(applicant).get(ownPath).expect(200);
    expect(own.body.contactVerified).toBe(false);
    await api(admin)
      .post(adminPath + '/contact-verifications')
      .send(verification)
      .expect(201);
    await api(admin)
      .patch(adminPath + '/review')
      .send({ status: 'ASSESSMENT' })
      .expect(400);
  });

  it('approves without automatically publishing and excludes expired/inactive/revoked providers immediately', async () => {
    await api(admin)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'ASSESSMENT', note: 'Isolated QA decision' })
      .expect(200);
    await api(admin)
      .patch(`/api/v1/admin/provider-applications/${applicationId}/review`)
      .send({ status: 'APPROVED', note: 'Isolated QA decision' })
      .expect(200);
    const profile = await database
      .getRepository(StaffProfile)
      .findOneByOrFail({ userId: applicantUserId });
    expect(profile.isPublic).toBe(false);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    // Complete actual C2 admin configuration in disposable QA; no implicit legal policy for production.
    const operationPath = `/api/v1/admin/provider-applications/${applicationId}`;
    const reason = 'Isolated C2 eligibility evidence';
    const expiry = new Date(Date.now() + 86400000 * 365).toISOString();
    const publicDto = {
      slug: 'qa-provider-' + suffix,
      title: 'QA wellness practitioner',
      yearsExperience: 3,
      isPublished: true,
      accuracyConfirmed: true,
      reason,
    };
    await api(applicant)
      .post(operationPath + '/public-profile')
      .send(publicDto)
      .expect(403);
    await api(admin)
      .post(operationPath + '/public-profile')
      .send({ ...publicDto, accuracyConfirmed: false })
      .expect(400);
    await api(admin)
      .post(operationPath + '/public-profile')
      .send(publicDto)
      .expect(201);
    await api(admin)
      .post(operationPath + '/operating-review')
      .send({ providerKind: 'WELLNESS', qualityStatus: 'ACTIVE', reason })
      .expect(201);
    await api(admin)
      .post(operationPath + '/skills')
      .send({ serviceId, certificateId, reason })
      .expect(201);
    await api(admin)
      .post(operationPath + '/branch-assignments')
      .send({ branchId, reason })
      .expect(201);
    await api(admin)
      .post(operationPath + '/weekly-shifts')
      .send({ branchId, weekday: 1, startsAtMinute: 540, endsAtMinute: 1020, reason })
      .expect(201);
    await api(admin)
      .patch(`/api/v1/admin/services/${serviceId}/variants/${variantId}`)
      .send({ isActive: true })
      .expect(200);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    const policyDto = {
      serviceId,
      branchId,
      courseId,
      mode: 'ON_SITE',
      jurisdictionCode: 'QA_REGION',
      territoryLabel: 'QA territory only',
      legalRequirement: 'NOT_REQUIRED',
      legalReviewReference: 'QA_POLICY_REVIEW_001',
      validUntil: expiry,
      isActive: true,
      legalReviewConfirmed: true,
      reason,
    };
    await api(applicant)
      .post('/api/v1/admin/service-provider-policies')
      .send(policyDto)
      .expect(403);
    const policy = await api(admin)
      .post('/api/v1/admin/service-provider-policies')
      .send(policyDto)
      .expect(201);
    const policyId: string = policy.body.id;
    const grantDto = {
      policyId,
      travelBufferMinutes: 0,
      travelFeeVnd: 0,
      isActive: true,
      conditionsConfirmed: true,
      reason,
    };
    const grant = await api(admin)
      .post(operationPath + '/service-grants')
      .send(grantDto)
      .expect(201);
    const grantId: string = grant.body.id;
    await api(applicant)
      .get(operationPath + '/service-configuration')
      .expect(403);
    await api()
      .get(operationPath + '/service-configuration')
      .expect(401);
    const config = await api(admin)
      .get(operationPath + '/service-configuration')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(config.body.grants[0].policyId).toBe(policyId);
    const selfPath = '/api/v1/admin/provider-applications/' + selfApplicationId;
    await api(admin)
      .post(selfPath + '/public-profile')
      .send({
        slug: 'qa-self-review',
        title: 'QA title',
        isPublished: false,
        accuracyConfirmed: true,
        reason,
      })
      .expect(400);
    await api(admin)
      .post(selfPath + '/operating-review')
      .send({ providerKind: 'WELLNESS', qualityStatus: 'PAUSED', reason })
      .expect(400);
    await api(admin)
      .post(selfPath + '/service-grants')
      .send({ ...grantDto, isActive: false })
      .expect(400);
    await api(admin)
      .post(operationPath + '/service-grants')
      .send({ ...grantDto, travelFeeVnd: 50000 })
      .expect(400);
    const homePolicy = await api(admin)
      .post('/api/v1/admin/service-provider-policies')
      .send({ ...policyDto, mode: 'AT_HOME' })
      .expect(201);
    const homeGrant = {
      ...grantDto,
      policyId: homePolicy.body.id,
      travelFeeVnd: 50000,
      travelBufferMinutes: 30,
      maxRadiusKm: 10,
    };
    await api(admin)
      .post(operationPath + '/service-grants')
      .send(homeGrant)
      .expect(400);
    await database.getRepository(Branch).update(branchId, { latitude: 10.777, longitude: 106.7 });
    const savedHome = await api(admin)
      .post(operationPath + '/service-grants')
      .send(homeGrant)
      .expect(201);
    const homeReady = await api(applicant)
      .get('/api/v1/provider-applications/me/service-readiness')
      .expect(200);
    expect(homeReady.body.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: 'AT_HOME',
          travelFeeVnd: '50000',
          maxRadiusKm: 10,
          travelBufferMinutes: 30,
        }),
      ]),
    );
    await database.getRepository(Branch).update(branchId, { latitude: null, longitude: null });
    await api(admin)
      .post(operationPath + '/service-grants')
      .send({ ...homeGrant, isActive: false })
      .expect(201);
    expect(
      (
        await api(admin)
          .get(operationPath + '/service-configuration')
          .expect(200)
      ).body.grants,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: savedHome.body.id, isActive: false })]),
    );
    const publicProfile = await api()
      .get(`/api/v1/providers/${applicationId}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(publicProfile.body.userId).toBeUndefined();
    expect(publicProfile.body.email).toBeUndefined();
    expect(publicProfile.body.avatarUrl).toBeNull();
    expect(publicProfile.body.bookable).toBe(false);
    expect(publicProfile.body.eligibleServices[0].serviceId).toBe(serviceId);
    expect(JSON.stringify(publicProfile.body)).not.toContain('QA_POLICY_REVIEW_001');
    await api(admin)
      .post(operationPath + '/operating-review')
      .send({ providerKind: 'WELLNESS', qualityStatus: 'PAUSED', reason })
      .expect(201);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await api(admin)
      .post(operationPath + '/operating-review')
      .send({ providerKind: 'SPECIALIST', qualityStatus: 'ACTIVE', reason })
      .expect(201);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await api(admin)
      .post(operationPath + '/service-grants')
      .send(grantDto)
      .expect(400);
    await api(admin)
      .post(operationPath + '/operating-review')
      .send({ providerKind: 'WELLNESS', qualityStatus: 'ACTIVE', reason })
      .expect(201);
    await api(admin)
      .post('/api/v1/admin/service-provider-policies')
      .send({ ...policyDto, legalRequirement: 'LICENSE_REQUIRED' })
      .expect(201);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await api(admin)
      .post(operationPath + '/service-grants')
      .send(grantDto)
      .expect(400);
    const credentialGrant = {
      ...grantDto,
      credentialReference: 'QA_PRIVATE_LEGAL_REFERENCE',
      credentialValidUntil: expiry,
    };
    await api(admin)
      .post(operationPath + '/service-grants')
      .send({ ...credentialGrant, conditionsConfirmed: false })
      .expect(400);
    await api(admin)
      .post(operationPath + '/service-grants')
      .send(credentialGrant)
      .expect(201);
    await api().get(`/api/v1/providers/${applicationId}`).expect(200);
    const ready = await api(applicant)
      .get('/api/v1/provider-applications/me/service-readiness')
      .expect(200);
    expect(ready.body.serviceReady).toBe(true);
    expect(ready.body.bookable).toBe(false);
    expect(JSON.stringify(ready.body)).not.toContain('QA_PRIVATE_LEGAL_REFERENCE');
    await database
      .getRepository(ProviderServiceGrant)
      .update(grantId, { credentialValidUntil: new Date(Date.now() - 1000) });
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await api(admin)
      .post(operationPath + '/service-grants')
      .send({
        ...credentialGrant,
        credentialValidUntil: new Date(Date.now() - 1000).toISOString(),
        isActive: false,
      })
      .expect(201);
    await api(admin)
      .post(operationPath + '/service-grants')
      .send(credentialGrant)
      .expect(201);
    await database
      .getRepository(ServiceProviderPolicy)
      .update(policyId, { validUntil: new Date(Date.now() - 1000) });
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await api(admin)
      .post('/api/v1/admin/service-provider-policies')
      .send({
        ...policyDto,
        validUntil: new Date(Date.now() - 1000).toISOString(),
        isActive: false,
      })
      .expect(201);
    await api(admin)
      .post('/api/v1/admin/service-provider-policies')
      .send({ ...policyDto, legalRequirement: 'LICENSE_REQUIRED' })
      .expect(201);
    const unrelatedCourse = await api(admin)
      .post('/api/v1/admin/provider-training/courses')
      .send({ code: 'QA_OTHER_' + suffix.slice(0, 8).toUpperCase(), title: 'QA unrelated course' })
      .expect(201);
    await api(admin)
      .post('/api/v1/admin/service-provider-policies')
      .send({
        ...policyDto,
        courseId: unrelatedCourse.body.id,
        legalRequirement: 'LICENSE_REQUIRED',
      })
      .expect(201);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await api(admin)
      .post('/api/v1/admin/service-provider-policies')
      .send({ ...policyDto, legalRequirement: 'LICENSE_REQUIRED' })
      .expect(201);
    await api().get(`/api/v1/providers/${applicationId}`).expect(200);
    await api(applicant)
      .patch('/api/v1/provider-applications/me')
      .send({ publicName: 'Unreviewed new name', introduction: 'QA', serviceArea: 'QA' })
      .expect(400);

    await api(applicant)
      .post('/api/v1/provider-applications/me/consent')
      .send({ scope: 'PUBLIC_PROFILE', version: 'provider-consent-v1', granted: false })
      .expect(201);
    await api()
      .get('/api/v1/providers/' + applicationId)
      .expect(404);
    await api(applicant)
      .post('/api/v1/provider-applications/me/consent')
      .send({ scope: 'PUBLIC_PROFILE', version: 'provider-consent-v1', granted: true })
      .expect(201);
    await api()
      .get('/api/v1/providers/' + applicationId)
      .expect(200);
    const trust = await api(admin)
      .get('/api/v1/admin/provider-applications/' + applicationId + '/eligibility')
      .expect(200);
    const contacts: Array<{ id: string; isCurrent: boolean }> = trust.body.contacts;
    const currentVerification = contacts.find((c: { isCurrent: boolean }) => c.isCurrent);
    await api(admin)
      .patch(
        '/api/v1/admin/provider-applications/' +
          applicationId +
          '/contact-verifications/' +
          currentVerification!.id +
          '/revoke',
      )
      .expect(200);
    await api()
      .get('/api/v1/providers/' + applicationId)
      .expect(404);
    await api(admin)
      .post('/api/v1/admin/provider-applications/' + applicationId + '/contact-verifications')
      .send({
        channel: 'EMAIL',
        contactValue: 'applicant-' + suffix + '@mocmaria.test',
        evidenceReference: 'QA_RECHECK_002',
        confirmedByContact: true,
      })
      .expect(201);

    await database.getRepository(ProviderCertificate).update(certificateId, {
      issuedAt: new Date(Date.now() - 172800000),
      expiresAt: new Date(Date.now() - 86400000),
    });
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await database.getRepository(ProviderCertificate).update(certificateId, { expiresAt: null });
    await database.getRepository(User).update(applicantUserId, { isActive: false });
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    await database.getRepository(User).update(applicantUserId, { isActive: true });
    await api(admin)
      .patch(
        `/api/v1/admin/provider-applications/${applicationId}/certificates/${certificateId}/revoke`,
      )
      .expect(200);
    await api().get(`/api/v1/providers/${applicationId}`).expect(404);
    const audit = await database
      .getRepository(AuditLog)
      .find({ where: { targetUserId: applicantUserId } });
    expect(audit.map((item) => item.event)).toEqual(
      expect.arrayContaining([
        'provider.application.reviewed',
        'provider.training.assessment_recorded',
        'provider.certificate.issued',
        'provider.certificate.revoked',
      ]),
    );
  });
});
