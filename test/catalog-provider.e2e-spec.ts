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
import { requireIsolatedDatabase } from './isolated-database';

describe('Catalog and provider lifecycle in isolated database', () => {
  let app: INestApplication;
  let database: DataSource;
  let admin: string;
  let applicant: string;
  let otherCustomer: string;
  let applicantUserId: string;
  let applicationId: string;
  let serviceId: string;
  let categoryId: string;
  let variantId: string;
  let enrollmentId: string;
  let certificateId: string;
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
      .expect(200);
    await api(admin)
      .post(`/api/v1/admin/provider-applications/${applicationId}/certificates`)
      .send({ courseCode, title: 'ignored title', certificateNumber })
      .expect(400);
    await api(applicant)
      .patch(`/api/v1/admin/provider-training/enrollments/${enrollmentId}/assessment`)
      .send({ attendancePercent: 100, assessmentPassed: true })
      .expect(403);
    await api(admin)
      .patch(`/api/v1/admin/provider-training/enrollments/${enrollmentId}/assessment`)
      .send({ attendancePercent: 100, assessmentPassed: true })
      .expect(200);
    const cert = await api(admin)
      .post(`/api/v1/admin/provider-applications/${applicationId}/certificates`)
      .send({ courseCode, title: 'ignored client title', certificateNumber })
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
    await database.getRepository(StaffProfile).update(profile.id, { isPublic: true });
    const publicProfile = await api()
      .get(`/api/v1/providers/${applicationId}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(publicProfile.body.userId).toBeUndefined();
    expect(publicProfile.body.email).toBeUndefined();
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
        'provider.training.assessed',
        'provider.certificate.issued',
        'provider.certificate.revoked',
      ]),
    );
  });
});
