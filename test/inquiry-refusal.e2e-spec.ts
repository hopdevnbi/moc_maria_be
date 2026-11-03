/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Supertest response bodies are untyped. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { requireIsolatedDatabase } from './isolated-database';

describe('KTV refusal HTTP contract and persistence in isolated PostgreSQL', () => {
  let app: INestApplication, db: DataSource;
  const actors: Array<{ id: string; token: string }> = [];
  const reason = 'Rất tiếc, tôi có lịch phục vụ khách trùng khung giờ khách yêu cầu.';
  const ids: Record<string, string> = {};
  const api = (actor?: number): ReturnType<typeof request.agent> => {
    const client = request.agent(app.getHttpServer());
    return actor === undefined
      ? client
      : client.set('Authorization', 'Bearer ' + actors[actor].token);
  };
  const endpoint = (state: string): string => '/api/v1/appointment-inquiries/' + ids[state];

  beforeAll(async () => {
    requireIsolatedDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 3; i++) {
      const email = `refusal-${randomUUID()}@mocmaria.test`;
      const password = randomBytes(24).toString('base64url') + '1!';
      const registered = await api()
        .post('/api/v1/auth/register')
        .send({ email, password, displayName: 'Isolated refusal ' + i })
        .expect(201);
      if (i > 0)
        await db.query(
          "INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='THERAPIST' ON CONFLICT DO NOTHING",
          [registered.body.user.id],
        );
      const login = await api()
        .post('/api/v1/auth/login')
        .send({ identifier: email, password })
        .expect(200);
      actors.push({ id: login.body.user.id, token: login.body.accessToken });
    }
    for (const status of ['PENDING', 'CONTACTED', 'CANCELLED', 'OFFICIAL', 'COMPLETED']) {
      const id = createHash('sha256').update(randomUUID()).digest('hex');
      ids[status] = id;
      const value = {
        id,
        customerId: actors[0].id,
        providerUserId: actors[1].id,
        status: ['OFFICIAL', 'COMPLETED'].includes(status) ? 'CONTACTED' : status,
        requestedAt: new Date().toISOString(),
        ...(status === 'OFFICIAL' ? { appointmentId: randomUUID() } : {}),
        ...(status === 'COMPLETED' ? { providerCompletedAt: new Date().toISOString() } : {}),
      };
      await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
        'mocmaria.inquiry.' + id,
        JSON.stringify(value),
      ]);
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it('validates reason at the HTTP boundary and protects ownership', async () => {
    const body = { status: 'DECLINED', reason };
    await api().patch(endpoint('PENDING')).send(body).expect(401);
    await api(0).patch(endpoint('PENDING')).send(body).expect(403);
    await api(2).patch(endpoint('PENDING')).send(body).expect(404);
    for (const invalid of [undefined, '', 'ngắn', ' '.repeat(10), 'x'.repeat(501)])
      await api(1)
        .patch(endpoint('PENDING'))
        .send({ status: 'DECLINED', reason: invalid })
        .expect(400);
    await api(1)
      .patch(endpoint('PENDING'))
      .send({ ...body, unexpected: true })
      .expect(400);
  });

  it.each(['PENDING', 'CONTACTED'])(
    'declines %s and persists the reason for KTV, customer and audit',
    async (state) => {
      const response = await api(1)
        .patch(endpoint(state))
        .send({ status: 'DECLINED', reason: '  ' + reason + '  ' })
        .expect(200);
      expect(response.body).toMatchObject({ status: 'DECLINED', declineReason: reason });
      for (const actor of [0, 1]) {
        const list = await api(actor).get('/api/v1/appointment-inquiries').expect(200);
        expect(list.body.find((item: { id: string }) => item.id === ids[state])).toMatchObject({
          status: 'DECLINED',
          declineReason: reason,
        });
      }
      const audit = await db.query<{ metadata: { reason: string } }[]>(
        "SELECT metadata FROM audit_logs WHERE event='appointment.inquiry.updated' AND metadata->>'inquiryId'=$1",
        [ids[state]],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].metadata.reason).toBe(reason);
      await api(1).patch(endpoint(state)).send({ status: 'DECLINED', reason }).expect(409);
    },
  );

  it('protects cancelled, official and completed records without writing audit events', async () => {
    for (const state of ['CANCELLED', 'OFFICIAL', 'COMPLETED']) {
      await api(1).patch(endpoint(state)).send({ status: 'DECLINED', reason }).expect(409);
      const audit = await db.query(
        "SELECT id FROM audit_logs WHERE event='appointment.inquiry.updated' AND metadata->>'inquiryId'=$1",
        [ids[state]],
      );
      expect(audit).toHaveLength(0);
    }
  });
});
