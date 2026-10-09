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
import { ProviderCertificate } from '../src/modules/providers/entities/provider-certificate.entity';
import { AuditLog } from '../src/modules/identity/entities/audit-log.entity';
import { requireIsolatedDatabase } from './isolated-database';

describe('Provider skills and schedules in disposable database', () => {
  let app: INestApplication;
  let database: DataSource;
  let admin: string;
  let applicant: string;
  let adminId: string;
  let applicantId: string;
  let applicationId: string;
  let branchId: string;
  let otherBranchId: string;
  let serviceId: string;
  let certificateId: string;
  let overrideId: string;
  const suffix = randomUUID().slice(0, 8);
  const password = randomBytes(32).toString('base64url') + '1!';
  const date = '2026-10-12'; // Monday, interpreted as a calendar date in Asia/Ho_Chi_Minh.
  const reason = 'Disposable QA scheduling evidence';
  function api(token?: string): ReturnType<typeof request.agent> {
    const agent = request.agent(app.getHttpServer()).set('Origin', 'http://localhost:3001');
    if (token) agent.set('Authorization', 'Bearer ' + token);
    return agent;
  }
  const path = (): string => `/api/v1/admin/provider-applications/${applicationId}`;

  beforeAll(async () => {
    requireIsolatedDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DataSource);
    const role = await database.getRepository(Role).findOneByOrFail({ name: 'SUPER_ADMIN' });
    const user = await database.getRepository(User).save({
      email: `schedule-admin-${suffix}@mocmaria.test`,
      displayName: 'QA schedule admin',
      isActive: true,
      passwordHash: await argon2.hash(password),
    });
    adminId = user.id;
    await database.getRepository(UserRole).save({ userId: user.id, roleId: role.id });
    admin = (
      await api().post('/api/v1/auth/login').send({ identifier: user.email, password }).expect(200)
    ).body.accessToken;
    const account = await api()
      .post('/api/v1/auth/register')
      .send({
        email: `schedule-applicant-${suffix}@mocmaria.test`,
        displayName: 'QA schedule applicant',
        password,
      })
      .expect(201);
    applicant = account.body.accessToken;
    applicantId = account.body.user.id;
    applicationId = (
      await api(applicant)
        .post('/api/v1/provider-applications')
        .send({
          publicName: 'QA scheduling only',
          introduction: 'Disposable fixture experience',
          serviceArea: 'QA area',
        })
        .expect(201)
    ).body.id;
    const categoryId = (
      await api(admin)
        .post('/api/v1/admin/service-categories')
        .send({ name: 'QA schedule category', slug: 'qa-schedule-category-' + suffix })
        .expect(201)
    ).body.id;
    serviceId = (
      await api(admin)
        .post('/api/v1/admin/services')
        .send({ categoryId, name: 'QA schedule service', slug: 'qa-schedule-service-' + suffix })
        .expect(201)
    ).body.id;
    for (const index of [1, 2]) {
      const id: string = (
        await api(admin)
          .post('/api/v1/admin/branches')
          .send({
            code: 'qa-schedule-' + index + '-' + suffix,
            name: 'QA branch ' + index,
            address: 'Isolated QA address',
            isActive: true,
          })
          .expect(201)
      ).body.id;
      if (index === 1) branchId = id;
      else otherBranchId = id;
      await api(admin)
        .put(`/api/v1/admin/branches/${id}/hours`)
        .send({ hours: [{ weekday: 1, opensAtMinute: 540, closesAtMinute: 1080 }] })
        .expect(200);
      await api(admin)
        .post(path() + '/branch-assignments')
        .send({ branchId: id, reason })
        .expect(201);
    }
    // Fixture certificate only in explicitly isolated QA. Production lifecycle is tested in catalog-provider suite.
    certificateId = (
      await database.getRepository(ProviderCertificate).save({
        providerApplicationId: applicationId,
        courseCode: 'QA_SCHEDULE_' + suffix,
        certificateNumber: 'QA_SCHEDULE_CERT_' + suffix,
        title: 'QA internal training only',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        issuedBy: adminId,
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('protects private planning and forbids self assignment even for administrators', async () => {
    await api()
      .get(path() + '/planning')
      .expect(401);
    await api(applicant)
      .post(path() + '/weekly-shifts')
      .send({ branchId, weekday: 1, startsAtMinute: 540, endsAtMinute: 600, reason })
      .expect(403);
    const ownAdmin = await api(admin)
      .post('/api/v1/provider-applications')
      .send({ publicName: 'QA admin own applicant' })
      .expect(201);
    await api(admin)
      .post(`/api/v1/admin/provider-applications/${ownAdmin.body.id}/branch-assignments`)
      .send({ branchId, reason })
      .expect(400);
    const own = await api(applicant).get('/api/v1/provider-applications/me/planning').expect(200);
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect(own.body.assignments).toHaveLength(2);
    expect(own.body.bookable).toBe(false);
  });

  it('requires applicant-owned current certificate and explicit audited skill assignment', async () => {
    await api(admin)
      .post(path() + '/skills')
      .send({ serviceId, certificateId: randomUUID(), reason })
      .expect(404);
    await api(applicant)
      .post(path() + '/skills')
      .send({ serviceId, certificateId, reason })
      .expect(403);
    await database
      .getRepository(ProviderCertificate)
      .update(certificateId, { revokedAt: new Date() });
    await api(admin)
      .post(path() + '/skills')
      .send({ serviceId, certificateId, reason })
      .expect(400);
    await database.getRepository(ProviderCertificate).update(certificateId, { revokedAt: null });
    await api(admin)
      .post(path() + '/skills')
      .send({ serviceId, certificateId, reason })
      .expect(201);
    const own = await api(applicant).get('/api/v1/provider-applications/me/planning').expect(200);
    expect(own.body.skills).toHaveLength(1);
    expect(own.body.skills[0]).not.toHaveProperty('reviewedBy');
    expect(own.body.skills[0].certificateValid).toBe(true);
    await database
      .getRepository(ProviderCertificate)
      .update(certificateId, { revokedAt: new Date() });
    const revoked = await api(applicant)
      .get('/api/v1/provider-applications/me/planning')
      .expect(200);
    expect(revoked.body.skills[0].certificateValid).toBe(false);
    await database.getRepository(ProviderCertificate).update(certificateId, { revokedAt: null });
    expect(
      await database
        .getRepository(AuditLog)
        .countBy({ event: 'provider.skill.assigned', targetUserId: applicantId }),
    ).toBe(1);
  });

  it('serializes concurrent overlap writes across branches and allows adjacent shifts', async () => {
    const dto = { branchId, weekday: 1, startsAtMinute: 480, endsAtMinute: 1020, reason };
    const responses = await Promise.all([
      api(admin)
        .post(path() + '/weekly-shifts')
        .send(dto),
      api(admin)
        .post(path() + '/weekly-shifts')
        .send({ ...dto, branchId: otherBranchId }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    // Normalize the winning branch for subsequent planning assertions using the normal disable flow.
    const winner = responses.find((r) => r.status === 201)!;
    if (winner.body.branchId !== branchId) {
      await api(admin)
        .patch(path() + `/weekly-shifts/${winner.body.id}/disable`)
        .send({ reason })
        .expect(200);
      await api(admin)
        .post(path() + '/weekly-shifts')
        .send(dto)
        .expect(201);
    }
    await api(admin)
      .post(path() + '/weekly-shifts')
      .send({ ...dto, branchId: otherBranchId, startsAtMinute: 1000, endsAtMinute: 1100 })
      .expect(409);
    await api(admin)
      .post(path() + '/weekly-shifts')
      .send({ ...dto, startsAtMinute: 1020, endsAtMinute: 1080 })
      .expect(201);
    await api(admin)
      .post(path() + '/weekly-shifts')
      .send({ ...dto, startsAtMinute: 700, endsAtMinute: 600 })
      .expect(400);
    await api(admin)
      .post(path() + '/weekly-shifts')
      .send({ ...dto, branchId: randomUUID() })
      .expect(400);
  });

  it('clips to branch hours, subtracts leave and uses dated overrides instead of recurring shifts', async () => {
    await api(admin)
      .post(path() + '/dated-schedules')
      .send({ kind: 'TIME_OFF', date, startsAtMinute: 720, endsAtMinute: 780, reason })
      .expect(201);
    let windows = await api(admin)
      .get(path() + `/planning/windows?branchId=${branchId}&date=${date}`)
      .expect(200);
    expect(windows.body.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(windows.body.windows).toEqual([
      { startsAtMinute: 540, endsAtMinute: 720 },
      { startsAtMinute: 780, endsAtMinute: 1020 },
      { startsAtMinute: 1020, endsAtMinute: 1080 },
    ]);
    const override = await api(admin)
      .post(path() + '/dated-schedules')
      .send({
        kind: 'OVERRIDE',
        branchId: otherBranchId,
        date,
        startsAtMinute: 840,
        endsAtMinute: 960,
        reason,
      })
      .expect(201);
    overrideId = override.body.id;
    windows = await api(admin)
      .get(path() + `/planning/windows?branchId=${branchId}&date=${date}`)
      .expect(200);
    expect(windows.body.windows).toEqual([]);
    windows = await api(admin)
      .get(path() + `/planning/windows?branchId=${otherBranchId}&date=${date}`)
      .expect(200);
    expect(windows.body.windows).toEqual([{ startsAtMinute: 840, endsAtMinute: 960 }]);
    expect(windows.body.bookable).toBe(false);
    await api(admin)
      .post(path() + '/dated-schedules')
      .send({ kind: 'OVERRIDE', branchId, date, startsAtMinute: 900, endsAtMinute: 1000, reason })
      .expect(409);
  });

  it('rejects malformed dates, cross-owner record changes and removes deactivated work immediately', async () => {
    await api(admin)
      .post(path() + '/dated-schedules')
      .send({ kind: 'TIME_OFF', date: '2026-02-29', startsAtMinute: 0, endsAtMinute: 1440, reason })
      .expect(400);
    await api(admin)
      .post(path() + '/dated-schedules')
      .send({ kind: 'TIME_OFF', branchId, date, startsAtMinute: 0, endsAtMinute: 1440, reason })
      .expect(400);
    await api(admin)
      .patch(path() + '/dated-schedules/' + randomUUID() + '/disable')
      .send({ reason })
      .expect(404);
    await api(admin)
      .post(path() + '/branch-assignments')
      .send({ branchId: otherBranchId, isActive: false, reason })
      .expect(201);
    const windows = await api(admin)
      .get(path() + `/planning/windows?branchId=${otherBranchId}&date=${date}`)
      .expect(200);
    expect(windows.body.windows).toEqual([]);
    await api(admin)
      .patch(path() + `/dated-schedules/${overrideId}/disable`)
      .send({ reason })
      .expect(200);
    const restored = await api(admin)
      .get(path() + `/planning/windows?branchId=${branchId}&date=${date}`)
      .expect(200);
    expect(restored.body.windows.length).toBeGreaterThan(0);
    await api(admin)
      .put(`/api/v1/admin/branches/${branchId}/exceptions`)
      .send({ date, isClosed: true })
      .expect(200);
    const closed = await api(admin)
      .get(path() + `/planning/windows?branchId=${branchId}&date=${date}`)
      .expect(200);
    expect(closed.body.windows).toEqual([]);
  });
});
