/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Supertest fixture responses are untyped. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { requireIsolatedDatabase } from './isolated-database';
describe('KTV completion permissions and atomic persistence in disposable PostgreSQL', () => {
  let app: INestApplication, db: DataSource;
  const actors: Array<{ id: string; token: string }> = [];
  const inquiryId = createHash('sha256').update(randomUUID()).digest('hex');
  const officialId = createHash('sha256').update(randomUUID()).digest('hex');
  const body = {
    servicePerformedConfirmed: true,
    reason: 'KTV xác nhận buổi chăm sóc đã diễn ra và hoàn thành.',
  };
  function api(index?: number): ReturnType<typeof request.agent> {
    const a = request.agent(app.getHttpServer());
    return index === undefined ? a : a.set('Authorization', 'Bearer ' + actors[index].token);
  }
  beforeAll(async () => {
    requireIsolatedDatabase();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 3; i++) {
      const email = `workspace-${randomUUID()}@mocmaria.test`,
        password = randomBytes(24).toString('base64url') + '1!';
      const r = await api()
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:3001')
        .send({ email, password, displayName: 'Isolated workspace ' + i })
        .expect(201);
      if (i > 0)
        await db.query(
          "INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='THERAPIST' ON CONFLICT DO NOTHING",
          [r.body.user.id],
        );
      const login = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3001')
        .send({ identifier: email, password })
        .expect(200);
      actors.push({ id: login.body.user.id, token: login.body.accessToken });
    }
    const value = {
      id: inquiryId,
      customerId: actors[0].id,
      customerName: 'Isolated customer',
      providerUserId: actors[1].id,
      providerName: 'Isolated KTV',
      serviceName: 'Isolated care',
      status: 'CONTACTED',
      requestedAt: new Date(Date.now() - 7200000).toISOString(),
      location: 'AT_BRANCH',
      address: 'Isolated branch',
    };
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      'mocmaria.inquiry.' + inquiryId,
      JSON.stringify(value),
    ]);
    const [provider] = await db.query<{ id: string }[]>(
      "INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,'Isolated KTV','APPROVED') RETURNING id",
      [actors[1].id],
    );
    const [branch] = await db.query<{ id: string }[]>(
      "INSERT INTO branches(name,code,address) VALUES('Isolated workspace',$1,'Isolated address') RETURNING id",
      [randomUUID()],
    );
    const [appt] = await db.query<{ id: string }[]>(
      `INSERT INTO appointments(customer_user_id,created_by,branch_id,mode,status,starts_at,ends_at,blocked_starts_at,blocked_ends_at,request_expires_at,idempotency_key,request_fingerprint,source)
      VALUES($1,$1,$2,'AT_BRANCH','CONFIRMED',now()-interval '2 hours',now()-interval '1 hour',now()-interval '2 hours',now()-interval '1 hour',now(),$3,$4,'ADMIN') RETURNING id`,
      [actors[0].id, branch.id, randomUUID(), 'b'.repeat(64)],
    );
    await db.query(
      'INSERT INTO appointment_staff(appointment_id,provider_application_id) VALUES($1,$2)',
      [appt.id, provider.id],
    );
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      'mocmaria.inquiry.' + officialId,
      JSON.stringify({
        ...value,
        id: officialId,
        appointmentId: appt.id,
        fulfillmentStatus: 'CONFIRMED',
      }),
    ]);
  });
  afterAll(async () => {
    await app?.close();
  });
  it('protects the endpoint from anonymous/customer/other-KTV requests and rejects unconfirmed service', async () => {
    const path = '/api/v1/provider/appointment-inquiries/' + inquiryId + '/complete';
    await api().post(path).send(body).expect(401);
    await api(0).post(path).send(body).expect(403);
    await api(2).post(path).send(body).expect(404);
    await api(1)
      .post(path)
      .send({ ...body, servicePerformedConfirmed: false })
      .expect(400);
  });
  it('deduplicates concurrent completion reports, persists across reads, and prevents cancellation after completion', async () => {
    const rows = await Promise.all(
      Array.from({ length: 4 }, () =>
        api(1)
          .post('/api/v1/provider/appointment-inquiries/' + inquiryId + '/complete')
          .send(body)
          .expect(201),
      ),
    );
    expect(new Set(rows.map((r) => String(r.body.providerCompletedAt))).size).toBe(1);
    const customer = await api(0).get('/api/v1/appointment-inquiries').expect(200);
    expect(
      customer.body.find((i: { id: string }) => i.id === inquiryId).providerCompletedAt,
    ).toBeTruthy();
    await api(0)
      .patch('/api/v1/appointment-inquiries/' + inquiryId)
      .send({ status: 'CANCELLED' })
      .expect(409);
    const [count] = await db.query<{ count: number }[]>(
      "SELECT count(*)::int AS count FROM audit_logs WHERE event='appointment.inquiry.provider_completed' AND metadata->>'inquiryId'=$1",
      [inquiryId],
    );
    expect(count.count).toBe(1);
    const [record] = await db.query<{ value: { appointmentId?: string; status: string } }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      ['mocmaria.inquiry.' + inquiryId],
    );
    expect(record.value.status).toBe('CONTACTED');
    expect(record.value.appointmentId).toBeUndefined();
  });
  it('starts and completes an assigned official appointment using actual PostgreSQL returned rows', async () => {
    await api(2)
      .patch('/api/v1/provider/inquiry-fulfillments/' + officialId + '/status')
      .send({
        status: 'IN_SERVICE',
        expectedVersion: 1,
        reason: 'Isolated provider starts service',
      })
      .expect(403);
    const start = await api(1)
      .patch('/api/v1/provider/inquiry-fulfillments/' + officialId + '/status')
      .send({
        status: 'IN_SERVICE',
        expectedVersion: 1,
        reason: 'Isolated provider starts service',
      })
      .expect(200);
    expect(start.body.status).toBe('IN_SERVICE');
    expect(start.body.version).toBe(2);
    const finish = await api(1)
      .patch('/api/v1/provider/inquiry-fulfillments/' + officialId + '/status')
      .send({ ...body, status: 'COMPLETED', expectedVersion: 2 })
      .expect(200);
    expect(finish.body.status).toBe('COMPLETED');
    expect(finish.body.version).toBe(3);
    await api(1)
      .patch('/api/v1/provider/inquiry-fulfillments/' + officialId + '/status')
      .send({ ...body, status: 'COMPLETED', expectedVersion: 2 })
      .expect(409);
    const history = await db.query<{ next_status: string }[]>(
      'SELECT next_status FROM appointment_status_history WHERE appointment_id=$1 ORDER BY created_at',
      [finish.body.appointmentId],
    );
    expect(history.map((h) => h.next_status)).toEqual(['IN_SERVICE', 'COMPLETED']);
  });
});
