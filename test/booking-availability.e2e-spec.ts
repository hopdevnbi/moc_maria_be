/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- Supertest JSON response is untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { User } from '../src/modules/identity/entities/user.entity';
import { Role } from '../src/modules/identity/entities/role.entity';
import { UserRole } from '../src/modules/identity/entities/user-role.entity';
import { ProviderCertificate } from '../src/modules/providers/entities/provider-certificate.entity';
import { Appointment } from '../src/modules/bookings/entities/appointment.entity';
import { instant, localDate, plusDays } from '../src/modules/bookings/availability-rules';
import { requireIsolatedDatabase } from './isolated-database';

describe('Booking availability in disposable database', () => {
  let app: INestApplication,
    database: DataSource,
    admin: string,
    applicant: string,
    adminId: string,
    applicantId: string;
  let providerId: string,
    branchId: string,
    serviceId: string,
    variantId: string,
    certificateId: string,
    resourceId: string;
  const suffix = randomUUID().slice(0, 8),
    password = randomBytes(32).toString('base64url') + '1!';
  const reason = 'Disposable booking QA evidence only';
  const date = plusDays(localDate(new Date()), 1),
    weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const expiry = new Date(Date.now() + 30 * 86400000).toISOString();
  const settings = (): Record<string, unknown> => ({
    variantId,
    branchId,
    mode: 'AT_BRANCH',
    isEnabled: true,
    slotStepMinutes: 15,
    leadMinutes: 0,
    horizonDays: 14,
    requestTtlMinutes: 15,
    resourceRequirements: [{ kind: 'ROOM', quantity: 1 }],
    configurationConfirmed: true,
    reason,
  });
  const query = (): Record<string, string> => ({
    branchId,
    variantId,
    date,
    providerApplicationId: providerId,
  });
  function api(token?: string): ReturnType<typeof request.agent> {
    const client = request.agent(app.getHttpServer()).set('Origin', 'http://localhost:3001');
    if (token) client.set('Authorization', 'Bearer ' + token);
    return client;
  }
  async function post(
    path: string,
    body: Record<string, unknown>,
    token = admin,
  ): Promise<{ id: string; reviewedBy?: string }> {
    return (
      await api(token)
        .post('/api/v1' + path)
        .send(body)
        .expect(201)
    ).body as { id: string; reviewedBy?: string };
  }
  async function patch(path: string, body: Record<string, unknown>, token = admin): Promise<void> {
    await api(token)
      .patch('/api/v1' + path)
      .send(body)
      .expect(200);
  }
  const providerPath = (): string => '/admin/provider-applications/' + providerId;
  beforeAll(async () => {
    requireIsolatedDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DataSource);
    const user = await database.manager.save(User, {
      email: 'booking-admin-' + suffix + '@mocmaria.test',
      displayName: 'QA booking admin',
      isActive: true,
      passwordHash: await argon2.hash(password),
    });
    adminId = user.id;
    const role = await database.manager.findOneByOrFail(Role, { name: 'SUPER_ADMIN' });
    await database.manager.save(UserRole, { userId: user.id, roleId: role.id });
    admin = (
      await api().post('/api/v1/auth/login').send({ identifier: user.email, password }).expect(200)
    ).body.accessToken;
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({
        email: 'booking-provider-' + suffix + '@mocmaria.test',
        displayName: 'QA booking provider',
        password,
      })
      .expect(201);
    applicant = registered.body.accessToken;
    applicantId = registered.body.user.id;
    providerId = String(
      (
        await post(
          '/provider-applications',
          {
            publicName: 'QA booking provider only',
            introduction: reason,
            serviceArea: 'QA area',
            applicationConsentVersion: 'provider-consent-v1',
          },
          applicant,
        )
      ).id,
    );
    await post(
      '/provider-applications/me/consent',
      { scope: 'PUBLIC_PROFILE', version: 'provider-consent-v1', granted: true },
      applicant,
    );
    await post(providerPath() + '/contact-verifications', {
      channel: 'EMAIL',
      contactValue: 'booking-provider-' + suffix + '@mocmaria.test',
      evidenceReference: 'QA_BOOK_CONTACT',
      confirmedByContact: true,
    });
    await patch(providerPath() + '/review', { status: 'REVIEWING', note: reason });
    await patch(providerPath() + '/review', { status: 'TRAINING', note: reason });
    branchId = String(
      (
        await post('/admin/branches', {
          code: 'qa-book-' + suffix,
          name: 'QA booking branch only',
          address: 'Disposable QA branch',
          isActive: true,
        })
      ).id,
    );
    await api(admin)
      .put('/api/v1/admin/branches/' + branchId + '/hours')
      .send({ hours: [{ weekday, opensAtMinute: 540, closesAtMinute: 1080 }] })
      .expect(200);
    const categoryId = String(
      (
        await post('/admin/service-categories', {
          slug: 'qa-book-' + suffix,
          name: 'QA booking category only',
          isPublished: true,
        })
      ).id,
    );
    serviceId = String(
      (
        await post('/admin/services', {
          categoryId,
          slug: 'qa-book-' + suffix,
          name: 'QA booking service only',
          isPublished: true,
        })
      ).id,
    );
    variantId = String(
      (
        await post('/admin/services/' + serviceId + '/variants', {
          name: 'QA60',
          durationMinutes: 60,
          priceVnd: 123456,
          bufferBeforeMinutes: 10,
          bufferAfterMinutes: 10,
          isActive: true,
        })
      ).id,
    );
    await post('/admin/branches/' + branchId + '/services', { serviceId, isActive: true });
    resourceId = String(
      (
        await post('/admin/branches/' + branchId + '/resources', {
          code: 'qa-room',
          name: 'QA room only',
          kind: 'ROOM',
          capacity: 2,
          isActive: true,
        })
      ).id,
    );
    const train = '/admin/provider-training',
      courseCode = 'QA_BOOK_' + suffix.toUpperCase();
    const courseId = String(
      (await post(train + '/courses', { code: courseCode, title: 'QA booking training only' })).id,
    );
    const moduleId = String(
      (
        await post(train + '/courses/' + courseId + '/modules', {
          code: 'PRACTICE',
          title: 'QA practice only',
          sortOrder: 0,
          isRequired: true,
          reason,
        })
      ).id,
    );
    await patch(train + '/courses/' + courseId + '/modules/' + moduleId + '/requirements', {
      requiredMinutes: 60,
      isRequired: true,
      isActive: true,
      requirementsConfirmed: true,
      reason,
    });
    const criterionId = String(
      (
        await post(train + '/courses/' + courseId + '/criteria', {
          code: 'SERVICE',
          title: 'QA observed practice',
          serviceId,
          minimumScore: 80,
          isRequired: true,
          isActive: true,
          criteriaConfirmed: true,
          reason,
        })
      ).id,
    );
    const enrollmentId = String(
      (await post(train + '/enrollments', { providerApplicationId: providerId, courseId })).id,
    );
    const sessionId = String(
      (
        await post(train + '/courses/' + courseId + '/sessions', {
          moduleId,
          instructorUserId: adminId,
          startsAt: new Date(Date.now() - 9 * 86400000).toISOString(),
          endsAt: new Date(Date.now() - 9 * 86400000 + 3600000).toISOString(),
          reason,
        })
      ).id,
    );
    await post(train + '/enrollments/' + enrollmentId + '/sessions', {
      sessionId,
      isActive: true,
      reason,
    });
    await patch(train + '/sessions/' + sessionId + '/state', {
      status: 'COMPLETED',
      completionReference: 'QA_BOOK_CLASS',
      recordConfirmed: true,
      reason,
    });
    await post(train + '/enrollments/' + enrollmentId + '/sessions/' + sessionId + '/attendance', {
      status: 'PRESENT',
      attendedMinutes: 60,
      evidenceReference: 'QA_BOOK_ATTENDANCE',
      attendanceConfirmed: true,
      reason,
    });
    await post(train + '/enrollments/' + enrollmentId + '/assessments', {
      scores: [{ criterionId, score: 95 }],
      evidenceReference: 'QA_BOOK_ASSESSMENT',
      validUntil: expiry,
      practicalConfirmed: true,
      reason,
    });
    certificateId = String(
      (
        await post(providerPath() + '/certificates', {
          courseCode,
          title: 'QA internal cert',
          certificateNumber: 'QA_BOOK_' + suffix.toUpperCase(),
          expiresAt: expiry,
          issuedConfirmed: true,
          reason,
        })
      ).id,
    );
    await patch(providerPath() + '/review', { status: 'ASSESSMENT', note: reason });
    await patch(providerPath() + '/review', { status: 'APPROVED', note: reason });
    await post(providerPath() + '/public-profile', {
      slug: 'qa-book-' + suffix,
      title: 'QA wellness provider only',
      isPublished: true,
      accuracyConfirmed: true,
      reason,
    });
    await post(providerPath() + '/operating-review', {
      providerKind: 'WELLNESS',
      qualityStatus: 'ACTIVE',
      reason,
    });
    await post(providerPath() + '/skills', { serviceId, certificateId, reason });
    await post(providerPath() + '/branch-assignments', { branchId, reason });
    await post(providerPath() + '/weekly-shifts', {
      branchId,
      weekday,
      startsAtMinute: 540,
      endsAtMinute: 1080,
      reason,
    });
    const policyId = String(
      (
        await post('/admin/service-provider-policies', {
          serviceId,
          branchId,
          courseId,
          mode: 'ON_SITE',
          jurisdictionCode: 'QA_REGION',
          territoryLabel: 'QA only',
          legalRequirement: 'NOT_REQUIRED',
          legalReviewReference: 'QA_BOOK_LEGAL',
          validUntil: expiry,
          isActive: true,
          legalReviewConfirmed: true,
          reason,
        })
      ).id,
    );
    await post(providerPath() + '/service-grants', {
      policyId,
      travelBufferMinutes: 0,
      travelFeeVnd: 0,
      isActive: true,
      conditionsConfirmed: true,
      reason,
    });
  });
  afterAll(async () => {
    await app?.close();
  });
  it('requires actual booking configuration, explicit confirmation and administration', async () => {
    const pending = await api().get('/api/v1/availability').query(query()).expect(200);
    expect(pending.body.slots).toEqual([]);
    expect(pending.body.blockers).toContain('BOOKING_CONFIGURATION_PENDING');
    await api().get('/api/v1/admin/booking-settings').expect(401);
    await api(applicant).post('/api/v1/admin/booking-settings').send(settings()).expect(403);
    await api(admin)
      .post('/api/v1/admin/booking-settings')
      .send({ ...settings(), configurationConfirmed: false })
      .expect(400);
    await api(admin)
      .post('/api/v1/admin/booking-settings')
      .send({
        ...settings(),
        resourceRequirements: [
          { kind: 'ROOM', quantity: 1 },
          { kind: 'ROOM', quantity: 1 },
        ],
      })
      .expect(400);
    const saved = await post('/admin/booking-settings', settings());
    expect(saved.reviewedBy).toBe(adminId);
  });
  it('intersects hours, provider skills and buffers with live price without promising a reservation', async () => {
    const preview = await api().get('/api/v1/availability').query(query()).expect(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.body.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(preview.body.reservation).toBe(false);
    expect(preview.body.requestEnabled).toBe(false);
    expect(preview.body.slots[0]).toMatchObject({
      startsAt: instant(date, 555).toISOString(),
      endsAt: instant(date, 615).toISOString(),
      priceVnd: '123456',
      travelFeeVnd: '0',
      totalVnd: '123456',
      providerApplicationId: providerId,
    });
    expect(JSON.stringify(preview.body)).not.toMatch(
      /resourceAllocation|resourceId|policyId|QA_BOOK_LEGAL|QA_BOOK_CONTACT|@mocmaria/,
    );
    await api()
      .get('/api/v1/availability')
      .query({ ...query(), date: '2026-02-30' })
      .expect(400);
    const past = await api()
      .get('/api/v1/availability')
      .query({ ...query(), date: plusDays(date, -2) })
      .expect(200);
    expect(past.body.slots).toEqual([]);
  });
  it('does not return slots after certificate expiry even when the certificate is valid now', async () => {
    await database.manager.update(ProviderCertificate, certificateId, {
      expiresAt: instant(date, 720),
    });
    const response = await api().get('/api/v1/availability').query(query()).expect(200);
    expect(response.body.slots.length).toBeGreaterThan(0);
    for (const slot of response.body.slots)
      expect(new Date(slot.endsAt).getTime() + 10 * 60000).toBeLessThanOrEqual(
        instant(date, 720).getTime(),
      );
    await database.manager.update(ProviderCertificate, certificateId, {
      expiresAt: new Date(expiry),
    });
  });
  it('blocks inactive provider accounts, quality suspension, time off and branch holidays immediately', async () => {
    await database.manager.update(User, applicantId, { isActive: false });
    expect((await api().get('/api/v1/availability').query(query()).expect(200)).body.slots).toEqual(
      [],
    );
    await database.manager.update(User, applicantId, { isActive: true });
    await post(providerPath() + '/operating-review', {
      providerKind: 'WELLNESS',
      qualityStatus: 'SUSPENDED',
      reason,
    });
    expect((await api().get('/api/v1/availability').query(query()).expect(200)).body.slots).toEqual(
      [],
    );
    await post(providerPath() + '/operating-review', {
      providerKind: 'WELLNESS',
      qualityStatus: 'ACTIVE',
      reason,
    });
    const timeOff = await post(providerPath() + '/dated-schedules', {
      date,
      kind: 'TIME_OFF',
      startsAtMinute: 540,
      endsAtMinute: 720,
      reason,
    });
    const response = await api().get('/api/v1/availability').query(query()).expect(200);
    expect(response.body.slots[0].startsAt).toBe(instant(date, 735).toISOString());
    await patch(providerPath() + '/dated-schedules/' + String(timeOff.id) + '/disable', { reason });
    await api(admin)
      .put('/api/v1/admin/branches/' + branchId + '/exceptions')
      .send({
        date,
        isClosed: true,
        note: reason,
      })
      .expect(200);
    expect((await api().get('/api/v1/availability').query(query()).expect(200)).body.slots).toEqual(
      [],
    );
    await api(admin)
      .put('/api/v1/admin/branches/' + branchId + '/exceptions')
      .send({
        date,
        isClosed: false,
        opensAtMinute: 540,
        closesAtMinute: 1080,
        note: reason,
      })
      .expect(200);
  });
  // Existing reservations are seeded only in disposable QA until E2 exposes request writes.
  async function reserve(status: Appointment['status'], expiresAt: Date): Promise<string> {
    const row = await database.manager.save(Appointment, {
      customerUserId: adminId,
      createdBy: adminId,
      branchId,
      mode: 'AT_BRANCH',
      status,
      startsAt: instant(date, 555),
      endsAt: instant(date, 615),
      blockedStartsAt: instant(date, 545),
      blockedEndsAt: instant(date, 625),
      requestExpiresAt: expiresAt,
      currentQuoteRevision: 1,
      idempotencyKey: randomUUID(),
      requestFingerprint: 'a'.repeat(64),
      version: 1,
      source: 'ADMIN',
      notes: null,
      destination: null,
    });
    return row.id;
  }
  it('subtracts provider reservations and releases declined/expired requests', async () => {
    const id = await reserve('CONFIRMED', new Date(Date.now() + 600000));
    await database.manager.query(
      'INSERT INTO appointment_staff(appointment_id,provider_application_id) VALUES($1,$2)',
      [id, providerId],
    );
    expect(
      (await api().get('/api/v1/availability').query(query()).expect(200)).body.slots[0].startsAt,
    ).toBe(instant(date, 645).toISOString());
    await database.manager.update(Appointment, id, { status: 'DECLINED' });
    expect(
      (await api().get('/api/v1/availability').query(query()).expect(200)).body.slots[0].startsAt,
    ).toBe(instant(date, 555).toISOString());
    await database.manager.update(Appointment, id, {
      status: 'REQUESTED',
      requestExpiresAt: new Date(Date.now() - 1000),
    });
    expect(
      (await api().get('/api/v1/availability').query(query()).expect(200)).body.slots[0].startsAt,
    ).toBe(instant(date, 555).toISOString());
  });
  it('honours resource capacity and returns a deterministic earliest slot', async () => {
    const id = await reserve('CONFIRMED', new Date(Date.now() + 600000));
    await database.manager.query(
      'INSERT INTO appointment_resources(appointment_id,resource_id,units) VALUES($1,$2,2)',
      [id, resourceId],
    );
    const earliest = await api().get('/api/v1/availability/earliest').query(query()).expect(200);
    expect(earliest.body.slots).toHaveLength(1);
    expect(earliest.body.slots[0].startsAt).toBe(instant(date, 645).toISOString());
    await database.manager.update(Appointment, id, { status: 'CANCELLED' });
    const next = await api().get('/api/v1/availability/earliest').query(query()).expect(200);
    expect(next.body.slots[0].startsAt).toBe(instant(date, 555).toISOString());
    await post('/admin/booking-settings', {
      ...settings(),
      resourceRequirements: [{ kind: 'EQUIPMENT', quantity: 1 }],
    });
    expect((await api().get('/api/v1/availability').query(query()).expect(200)).body.slots).toEqual(
      [],
    );
    await post('/admin/booking-settings', settings());
  });
});
