/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Supertest responses are untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { KtvChatService } from '../src/modules/ktv-chat/ktv-chat.service';
import { requireIsolatedDatabase } from './isolated-database';

describe('Moderated presentations and appointment inquiries in isolated PostgreSQL', () => {
  let app: INestApplication,
    db: DataSource,
    providerId: string,
    revisionId: string,
    inquiryId: string;
  const actors: Array<{ id: string; token: string }> = [];
  const description =
    'Chăm sóc nhẹ nhàng, lắng nghe nhu cầu và điều chỉnh liệu trình theo sự thoải mái của khách.';
  const revised =
    'Ưu tiên trải nghiệm thư giãn, trao đổi rõ ràng trước mỗi liệu trình và chú trọng cảm nhận của bạn.';
  function api(index?: number): ReturnType<typeof request.agent> {
    const a = request.agent(app.getHttpServer());
    return index === undefined ? a : a.set('Authorization', 'Bearer ' + actors[index].token);
  }
  const body =
    (): import('../src/modules/customer-experience/experience.dto').CreateInquiryDto => ({
      idempotencyKey: randomUUID(),
      providerId,
      serviceId: 'neck',
      location: 'AT_HOME',
      address: '12 Nguyễn Trãi, Thanh Xuân, Hà Nội',
      requestedAt: new Date(Date.now() + 86400000).toISOString(),
      notes: '60 phút',
    });
  beforeAll(async () => {
    requireIsolatedDatabase();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 4; i++) {
      const email = `experience-${randomUUID()}@mocmaria.test`,
        password = randomBytes(24).toString('base64url') + '1!';
      const r = await api()
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:3001')
        .send({ email, password, displayName: 'QA experience ' + i })
        .expect(201);
      const id = r.body.user.id;
      if (i === 1 || i === 2) {
        await db.query(
          `INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2 ON CONFLICT DO NOTHING`,
          [id, i === 1 ? 'THERAPIST' : 'SUPER_ADMIN'],
        );
      }
      const login = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3001')
        .send({ identifier: email, password })
        .expect(200);
      actors.push({ id, token: login.body.accessToken });
    }
    const [p] = await db.query<{ id: string }[]>(
      `INSERT INTO provider_applications(user_id,public_name,introduction,status) VALUES($1,'QA KTV','Original approved introduction','APPLIED') RETURNING id`,
      [actors[1].id],
    );
    providerId = p.id;
    jest.spyOn(app.get(KtvChatService), 'directory').mockResolvedValue([
      {
        id: providerId,
        publicName: 'QA KTV',
        title: 'KTV',
        serviceArea: 'Hà Nội',
        avatarUrl: null,
        services: [{ id: 'neck', name: 'Massage cổ vai gáy' }],
      },
    ]);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });
  it('requires auth and KTV ownership to submit; only SUPER_ADMIN can review', async () => {
    await api().get('/api/v1/provider-presentation/me').expect(401);
    await api(0)
      .post('/api/v1/provider-presentation/me')
      .send({ introduction: description })
      .expect(403);
    await api(1).get('/api/v1/admin/provider-presentation').expect(403);
    await api(0).get('/api/v1/admin/provider-presentation').expect(403);
  });
  it('keeps pending description private and rejects stale review versions', async () => {
    const r = await api(1)
      .post('/api/v1/provider-presentation/me')
      .send({ introduction: description })
      .expect(201);
    revisionId = r.body.revision.id;
    expect((await api().get('/api/v1/provider-presentation').expect(200)).body).toEqual([]);
    const list = await api(2).get('/api/v1/admin/provider-presentation').expect(200);
    expect(list.body.some((p: { providerId: string }) => p.providerId === providerId)).toBe(true);
    await api(2)
      .patch('/api/v1/admin/provider-presentation/' + providerId)
      .send({ revisionId: randomUUID(), decision: 'APPROVED', note: 'ok' })
      .expect(409);
  });
  it('publishes only an approved revision and retains it while edits are pending/rejected', async () => {
    await api(2)
      .patch('/api/v1/admin/provider-presentation/' + providerId)
      .send({ revisionId, decision: 'APPROVED', note: 'Nội dung phù hợp' })
      .expect(200);
    const pub = await api().get('/api/v1/provider-presentation').expect(200);
    expect(pub.body).toContainEqual({ providerId, introduction: description });
    expect(JSON.stringify(pub.body)).not.toContain('revision');
    const next = await api(1)
      .post('/api/v1/provider-presentation/me')
      .send({ introduction: revised })
      .expect(201);
    revisionId = next.body.revision.id;
    expect((await api().get('/api/v1/provider-presentation')).body).toContainEqual({
      providerId,
      introduction: description,
    });
    await api(2)
      .patch('/api/v1/admin/provider-presentation/' + providerId)
      .send({ revisionId, decision: 'REJECTED', note: 'Bổ sung thế mạnh' })
      .expect(200);
    expect((await api().get('/api/v1/provider-presentation')).body).toContainEqual({
      providerId,
      introduction: description,
    });
  });
  it('rejects forged service, invalid address and past time', async () => {
    await api(0)
      .post('/api/v1/appointment-inquiries')
      .send({ ...body(), serviceId: 'forged' })
      .expect(400);
    await api(0)
      .post('/api/v1/appointment-inquiries')
      .send({ ...body(), address: 'short' })
      .expect(400);
    await api(0)
      .post('/api/v1/appointment-inquiries')
      .send({ ...body(), requestedAt: '2020-01-01T10:00:00Z' })
      .expect(400);
  });
  it('creates one inquiry under concurrent retries and does not expose it to outsiders/public', async () => {
    const b = body();
    const results = await Promise.all([
      api(0).post('/api/v1/appointment-inquiries').send(b).expect(201),
      api(0).post('/api/v1/appointment-inquiries').send(b).expect(201),
    ]);
    inquiryId = results[0].body.id;
    expect(results[1].body.id).toBe(inquiryId);
    expect(results[0].body.region).toBe('Hà Nội');
    expect(results[0].body.status).toBe('PENDING');
    expect(results[0].body).not.toHaveProperty('signature');
    await api(0)
      .post('/api/v1/appointment-inquiries')
      .send({ ...b, notes: 'changed' })
      .expect(409);
    expect(
      (await api(0).get('/api/v1/appointment-inquiries')).body.some(
        (r: { id: string }) => r.id === inquiryId,
      ),
    ).toBe(true);
    expect(
      (await api(1).get('/api/v1/appointment-inquiries')).body.some(
        (r: { id: string }) => r.id === inquiryId,
      ),
    ).toBe(true);
    expect((await api(3).get('/api/v1/appointment-inquiries')).body).toEqual([]);
    await api().get('/api/v1/appointment-inquiries').expect(401);
  });
  it('enforces distinct customer/provider lifecycle permissions', async () => {
    await api(3)
      .patch('/api/v1/appointment-inquiries/' + inquiryId)
      .send({ status: 'CONTACTED' })
      .expect(404);
    await api(0)
      .patch('/api/v1/appointment-inquiries/' + inquiryId)
      .send({ status: 'CONTACTED' })
      .expect(403);
    await api(1)
      .patch('/api/v1/appointment-inquiries/' + inquiryId)
      .send({ status: 'CANCELLED' })
      .expect(403);
    await api(1)
      .patch('/api/v1/appointment-inquiries/' + inquiryId)
      .send({ status: 'CONTACTED' })
      .expect(200);
    await api(0)
      .patch('/api/v1/appointment-inquiries/' + inquiryId)
      .send({ status: 'CANCELLED' })
      .expect(200);
    await api(1)
      .patch('/api/v1/appointment-inquiries/' + inquiryId)
      .send({ status: 'DECLINED' })
      .expect(409);
  });
  it('honors reciprocal contact blocks, including timed expiration', async () => {
    const [t] = await db.query<{ id: string }[]>(
      `INSERT INTO ktv_chat_threads(customer_user_id,provider_user_id,provider_application_id) VALUES($1,$2,$3) RETURNING id`,
      [actors[0].id, actors[1].id, providerId],
    );
    await db.query(`INSERT INTO ktv_chat_blocks(thread_id,blocker_user_id) VALUES($1,$2)`, [
      t.id,
      actors[1].id,
    ]);
    await api(0).post('/api/v1/appointment-inquiries').send(body()).expect(403);
    await db.query(
      `UPDATE ktv_chat_blocks SET expires_at=clock_timestamp()-interval '1 minute' WHERE thread_id=$1`,
      [t.id],
    );
    await api(0).post('/api/v1/appointment-inquiries').send(body()).expect(201);
  });
});
