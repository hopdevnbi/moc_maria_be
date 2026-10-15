/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Supertest fixture responses are untyped. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { requireIsolatedDatabase } from './isolated-database';

describe('Super Admin booking lifecycle in disposable PostgreSQL', () => {
  let app: INestApplication, db: DataSource, provider: string, branch: string;
  const actors: Array<{ id: string; token: string }> = [];
  const reason = 'Cập nhật tiến độ theo kết quả xử lý lịch chăm sóc.';
  const prefix = 'Lifecycle QA ' + randomUUID();
  function api(index?: number): ReturnType<typeof request.agent> {
    const a = request.agent(app.getHttpServer());
    return index === undefined ? a : a.set('Authorization', 'Bearer ' + actors[index].token);
  }
  const base = '/api/v1/admin/appointment-inquiries/';
  async function inquiry(status = 'PENDING', extra = {}): Promise<string> {
    const id = createHash('sha256').update(randomUUID()).digest('hex');
    const value = {
      id,
      customerId: actors[0].id,
      customerName: prefix,
      providerUserId: actors[3].id,
      providerId: provider,
      providerName: 'Isolated KTV',
      serviceName: 'Isolated care',
      status,
      requestedAt: new Date(Date.now() - 7200000).toISOString(),
      createdAt: new Date().toISOString(),
      location: 'AT_BRANCH',
      address: 'Isolated address',
      notes: '',
      ...extra,
    };
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      'mocmaria.inquiry.' + id,
      JSON.stringify(value),
    ]);
    return id;
  }
  async function appointment(status: string): Promise<string> {
    const [row] = await db.query<{ id: string }[]>(
      `INSERT INTO appointments(customer_user_id,created_by,branch_id,mode,status,starts_at,ends_at,blocked_starts_at,blocked_ends_at,request_expires_at,idempotency_key,request_fingerprint,source)
      VALUES($1,$1,$2,'AT_BRANCH',$3,now()-interval '2 hours',now()-interval '1 hour',now()-interval '2 hours',now()-interval '1 hour',now()+interval '1 day',$4,$5,'ADMIN') RETURNING id`,
      [actors[0].id, branch, status, randomUUID(), 'b'.repeat(64)],
    );
    await db.query(
      'INSERT INTO appointment_staff(appointment_id,provider_application_id) VALUES($1,$2)',
      [row.id, provider],
    );
    return row.id;
  }
  beforeAll(async () => {
    requireIsolatedDatabase();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 5; i++) {
      const email = `lifecycle-${randomUUID()}@mocmaria.test`,
        password = randomBytes(24).toString('base64url') + '1!';
      const r = await api()
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:3001')
        .send({ email, password, displayName: 'Isolated lifecycle ' + i })
        .expect(201);
      const role = [null, 'SUPER_ADMIN', 'ADMIN', 'THERAPIST', 'THERAPIST'][i];
      if (role)
        await db.query(
          'INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2 ON CONFLICT DO NOTHING',
          [r.body.user.id, role],
        );
      const login = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3001')
        .send({ identifier: email, password })
        .expect(200);
      actors.push({ id: login.body.user.id, token: login.body.accessToken });
    }
    const [p] = await db.query<{ id: string }[]>(
      "INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,'Isolated lifecycle KTV','APPROVED') RETURNING id",
      [actors[3].id],
    );
    provider = p.id;
    const [b] = await db.query<{ id: string }[]>(
      "INSERT INTO branches(name,code,address) VALUES('Isolated lifecycle',$1,'Isolated address') RETURNING id",
      [randomUUID()],
    );
    branch = b.id;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('guards privileges and explicit attestation, and keeps the ordinary Admin intake permission', async () => {
    const id = await inquiry();
    await api()
      .patch(base + id)
      .send({ status: 'COMPLETED', reason })
      .expect(401);
    await api(0)
      .patch(base + id)
      .send({ status: 'COMPLETED', reason })
      .expect(403);
    await api(2)
      .patch(base + id)
      .send({ status: 'COMPLETED', reason, servicePerformedConfirmed: true })
      .expect(403);
    await api(1)
      .patch(base + id)
      .send({ status: 'COMPLETED', reason })
      .expect(400);
    const changed = await api(2)
      .patch(base + id)
      .send({ status: 'CONTACTED', expectedStatus: 'PENDING', reason })
      .expect(200);
    expect(changed.body.canManageStatus).toBe(false);
    await api(2)
      .patch(base + id)
      .send({ status: 'DECLINED', reason })
      .expect(409);
  });
  it('counts KTV completion once, shows its history, and permits an audited correction without fabricating an appointment', async () => {
    const stamp = new Date().toISOString();
    const id = await inquiry('CONTACTED', { providerCompletedAt: stamp });
    await db.query(
      "INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata) VALUES('appointment.inquiry.provider_completed',$1,$2,$3::jsonb)",
      [actors[3].id, actors[0].id, JSON.stringify({ inquiryId: id, reason })],
    );
    const complete = await api(1)
      .get(base.slice(0, -1))
      .query({ status: 'COMPLETED', q: prefix, limit: 100 })
      .expect(200);
    expect(complete.body.items.some((i: { id: string }) => i.id === id)).toBe(true);
    expect(complete.body.counts.ALL).toBe(
      Object.entries(complete.body.counts)
        .filter(([k]) => !['ALL', 'ARCHIVED'].includes(k))
        .reduce((n, [, v]) => n + Number(v), 0),
    );
    const detail = await api(1)
      .get(base + id)
      .expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.history[0].event).toBe('appointment.inquiry.provider_completed');
    const reopened = await api(1)
      .patch(base + id)
      .send({
        status: 'PENDING',
        expectedStatus: 'COMPLETED',
        expectedUpdatedAt: detail.body.updatedAt,
        reason,
      })
      .expect(200);
    expect(reopened.body.providerCompletedAt).toBeUndefined();
    expect(reopened.body.appointmentId).toBeUndefined();
    const [audit] = await db.query<{ metadata: { previousCompletionAt: string } }[]>(
      "SELECT metadata FROM audit_logs WHERE event='appointment.inquiry.admin_updated' AND metadata->>'inquiryId'=$1",
      [id],
    );
    expect(audit.metadata.previousCompletionAt).toBe(stamp);
    const customer = await api(0).get('/api/v1/appointment-inquiries').expect(200);
    expect(customer.body.find((i: { id: string }) => i.id === id).status).toBe('PENDING');
    for (const status of [
      'CONFIRMED',
      'IN_SERVICE',
      'COMPLETED',
      'DECLINED',
      'CANCELLED',
      'CONTACTED',
    ]) {
      const r = await api(1)
        .patch(base + id)
        .send({ status, reason, servicePerformedConfirmed: status === 'COMPLETED' })
        .expect(200);
      expect(r.body.status).toBe(status);
    }
  });
  it('rejects a stale dialog and serializes concurrent writers to one update', async () => {
    const id = await inquiry();
    const detail = await api(1)
      .get(base + id)
      .expect(200);
    const body = {
      status: 'CONFIRMED',
      expectedStatus: 'PENDING',
      expectedUpdatedAt: detail.body.updatedAt,
      reason,
    };
    const replies = await Promise.all([
      api(1)
        .patch(base + id)
        .send(body),
      api(1)
        .patch(base + id)
        .send(body),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const [row] = await db.query<{ count: number }[]>(
      "SELECT count(*)::int AS count FROM audit_logs WHERE event='appointment.inquiry.admin_updated' AND metadata->>'inquiryId'=$1",
      [id],
    );
    expect(row.count).toBe(1);
  });
  it('synchronizes real appointment/version/history, trusts its actual status, and blocks conflicting reactivation atomically', async () => {
    const appt = await appointment('COMPLETED');
    const id = await inquiry('CONTACTED', { appointmentId: appt, fulfillmentStatus: 'CONFIRMED' });
    const before = await api(1)
      .get(base + id)
      .expect(200);
    expect(before.body.status).toBe('COMPLETED');
    expect(before.body.appointmentVersion).toBe(1);
    const conflict = await appointment('CONFIRMED');
    await api(1)
      .patch(base + id)
      .send({ status: 'CONFIRMED', expectedAppointmentVersion: 1, reason })
      .expect(409);
    const [unchanged] = await db.query<{ status: string; version: number }[]>(
      'SELECT status,version FROM appointments WHERE id=$1',
      [appt],
    );
    expect(unchanged).toMatchObject({ status: 'COMPLETED', version: 1 });
    await db.query("UPDATE appointments SET status='CANCELLED' WHERE id=$1", [conflict]);
    await api(1)
      .patch(base + id)
      .send({ status: 'CONFIRMED', expectedAppointmentVersion: 1, reason })
      .expect(200);
    await api(1)
      .patch(base + id)
      .send({
        status: 'COMPLETED',
        expectedAppointmentVersion: 1,
        reason,
        servicePerformedConfirmed: true,
      })
      .expect(409);
    const finished = await api(1)
      .patch(base + id)
      .send({
        status: 'COMPLETED',
        expectedAppointmentVersion: 2,
        reason,
        servicePerformedConfirmed: true,
      })
      .expect(200);
    expect(finished.body.appointmentVersion).toBe(3);
    const history = await db.query<{ next_status: string }[]>(
      'SELECT next_status FROM appointment_status_history WHERE appointment_id=$1 ORDER BY created_at',
      [appt],
    );
    expect(history.map((h) => h.next_status)).toEqual(['CONFIRMED', 'COMPLETED']);
  });
  it('preserves archived history and permits Super Admin correction without unarchiving it', async () => {
    const id = await inquiry('CANCELLED', { archivedAt: new Date().toISOString() });
    const r = await api(1)
      .patch(base + id)
      .send({ status: 'COMPLETED', reason, servicePerformedConfirmed: true })
      .expect(200);
    expect(r.body.archivedAt).toBeTruthy();
    expect(r.body.history).toHaveLength(1);
  });
  it('lets only the assigned KTV start a confirmed legacy request, then complete it', async () => {
    const id = await inquiry('CONFIRMED');
    const path = '/api/v1/provider/appointment-inquiries/' + id;
    await api(4)
      .post(path + '/start')
      .send({ reason })
      .expect(404);
    await api(0)
      .post(path + '/start')
      .send({ reason })
      .expect(403);
    await api(3)
      .post(path + '/start')
      .send({ reason })
      .expect(201);
    await api(3)
      .post(path + '/complete')
      .send({ reason, servicePerformedConfirmed: true })
      .expect(201);
    const done = await api(1)
      .get(base + id)
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');
    const future = await inquiry('CONFIRMED', {
      requestedAt: new Date(Date.now() + 7200000).toISOString(),
    });
    await api(3)
      .post('/api/v1/provider/appointment-inquiries/' + future + '/start')
      .send({ reason })
      .expect(400);
  });
});
