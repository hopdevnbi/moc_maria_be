/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- Supertest response JSON. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { requireIsolatedDatabase } from './isolated-database';
import type { ChatProvider } from '../src/modules/ktv-chat/ktv-chat.service';

describe('Owner-seeded consultation with real registration/auth in disposable DB', () => {
  let app: INestApplication,
    db: DataSource,
    customer: string,
    other: string,
    ktv: string,
    providerId: string,
    providerUserId: string,
    threadId: string;
  let accounts: Array<{
    seedId: string;
    userId: string;
    applicationId: string;
    chatEnabled: boolean;
  }>;
  const api = (token?: string): ReturnType<typeof request.agent> => {
    const a = request.agent(app.getHttpServer()).set('Origin', 'http://localhost:3001');
    return token ? a.set('Authorization', 'Bearer ' + token) : a;
  };
  beforeAll(async () => {
    requireIsolatedDatabase();
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    const password = randomBytes(24).toString('base64url') + 'A9!';
    const first = await api()
      .post('/api/v1/auth/register')
      .send({
        displayName: 'Consultation customer',
        email: randomUUID() + '@mocmaria.test',
        password,
      })
      .expect(201);
    customer = first.body.accessToken;
    const second = await api()
      .post('/api/v1/auth/register')
      .send({ displayName: 'Other customer', email: randomUUID() + '@mocmaria.test', password })
      .expect(201);
    other = second.body.accessToken;
    accounts = [];
    for (let i = 0; i < 2; i++) {
      const email = randomUUID() + '@mocmaria.test';
      const [user] = await db.query<{ id: string }[]>(
        'INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',
        [email, 'Seed KTV ' + i, await argon2.hash(password)],
      );
      await db.query(
        "INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='THERAPIST'",
        [user.id],
      );
      await db.query(
        "INSERT INTO staff_profiles(user_id,public_name,avatar_url,is_active,is_public) VALUES($1,$2,'/media/ktv/activity.webp',true,false)",
        [user.id, 'Seed KTV ' + i],
      );
      const [p] = await db.query<{ id: string }[]>(
        "INSERT INTO provider_applications(user_id,public_name,introduction,service_area,status) VALUES($1,$2,'Care consultation','Hà Nội','APPLIED') RETURNING id",
        [user.id, 'Seed KTV ' + i],
      );
      accounts.push({
        seedId: 'demo-ktv-0' + (i + 1),
        userId: user.id,
        applicationId: p.id,
        chatEnabled: i === 0,
      });
      if (i === 0) {
        providerId = p.id;
        providerUserId = user.id;
        const login = await api()
          .post('/api/v1/auth/login')
          .send({ identifier: email, password })
          .expect(200);
        ktv = login.body.accessToken;
      }
    }
    await db.query(
      "INSERT INTO app_metadata(key,value) VALUES('mocmaria.ktv.accounts.v1',$1::jsonb)",
      [JSON.stringify({ accounts })],
    );
    await db.query("INSERT INTO app_metadata(key,value) VALUES('mocmaria.demo.ktv.v1',$1::jsonb)", [
      JSON.stringify({
        profiles: accounts.map((a) => ({
          id: a.seedId,
          demoServices: [{ id: 'demo-neck', name: 'Massage cổ vai gáy' }],
        })),
      }),
    ]);
  });
  afterAll(async () => {
    await app?.close();
  });
  it('offers only opted-in KTV; exposes public consultation data without certifying/bookabling them', async () => {
    const list = await api().get('/api/v1/ktv-chat/providers').expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    const seeded = (list.body as ChatProvider[]).filter((p: { id: string }) =>
      accounts.some((a) => a.applicationId === p.id),
    );
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({
      id: providerId,
      publicAlias: 'demo-ktv-01',
      services: [{ id: 'demo-neck', name: 'Massage cổ vai gáy' }],
    });
    expect(seeded[0]).not.toHaveProperty('user_id');
    expect(seeded[0]).not.toHaveProperty('email');
    expect(seeded[0]).not.toHaveProperty('trainingBadge');
    const publicProviders = await api().get('/api/v1/providers').expect(200);
    expect((publicProviders.body as ChatProvider[]).map((p: { id: string }) => p.id)).not.toContain(
      providerId,
    );
    expect((publicProviders.body as ChatProvider[]).map((p: { id: string }) => p.id)).not.toContain(
      accounts[1].applicationId,
    );
  });
  it('opens private chat from a normally registered customer and binds to the actual KTV account', async () => {
    const open = await api(customer)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerId })
      .expect(201);
    threadId = open.body.id;
    expect(open.body.provider_user_id).toBe(providerUserId);
    expect(open.body.can_send).toBe(true);
    const again = await api(customer)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerId })
      .expect(201);
    expect(again.body.id).toBe(threadId);
    await api(customer)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: accounts[1].applicationId })
      .expect(404);
    await api(ktv)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerId })
      .expect(403);
  });
  it('sends emoji in both directions and keeps outsiders out', async () => {
    await api(customer)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Tư vấn massage cổ vai gáy 😊', clientMessageId: randomUUID() })
      .expect(201);
    await api(ktv)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Mình hỗ trợ bạn nhé 🌿', clientMessageId: randomUUID() })
      .expect(201);
    const history = await api(customer)
      .get(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .expect(200);
    expect(history.body).toHaveLength(2);
    await api(other).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(404);
  });
  it('lets KTV temporarily block, expire and unblock without deleting history', async () => {
    await api(ktv)
      .post(`/api/v1/ktv-chat/threads/${threadId}/block`)
      .send({ mode: 'TEMPORARY', durationMinutes: 1, reason: 'Test courtesy' })
      .expect(201);
    await api(customer)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Blocked message' })
      .expect(403);
    await db.query(
      "UPDATE ktv_chat_blocks SET expires_at=clock_timestamp()-interval '1 second' WHERE thread_id=$1 AND blocker_user_id=$2",
      [threadId, providerUserId],
    );
    await api(customer)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Sau hết hạn 👋' })
      .expect(201);
    await api(ktv)
      .post(`/api/v1/ktv-chat/threads/${threadId}/block`)
      .send({ mode: 'PERMANENT' })
      .expect(201);
    await api(ktv).post(`/api/v1/ktv-chat/threads/${threadId}/unblock`).send({}).expect(201);
    await api(ktv)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Mở lại rồi' })
      .expect(201);
  });
  it('lets customers block in reverse and preserves the other person’s block', async () => {
    await api(customer)
      .post(`/api/v1/ktv-chat/threads/${threadId}/block`)
      .send({ mode: 'PERMANENT' })
      .expect(201);
    await api(ktv).post(`/api/v1/ktv-chat/threads/${threadId}/unblock`).send({}).expect(201);
    await api(ktv)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Still blocked' })
      .expect(403);
    await api(customer).post(`/api/v1/ktv-chat/threads/${threadId}/unblock`).send({}).expect(201);
  });
  it('revokes opted-in chat when disabled, inactive or suspended; retains history', async () => {
    accounts[0].chatEnabled = false;
    await db.query("UPDATE app_metadata SET value=$1::jsonb WHERE key='mocmaria.ktv.accounts.v1'", [
      JSON.stringify({ accounts }),
    ]);
    expect(
      ((await api().get('/api/v1/ktv-chat/providers').expect(200)).body as ChatProvider[]).map(
        (p: { id: string }) => p.id,
      ),
    ).not.toContain(providerId);
    await api(customer)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Disabled' })
      .expect(403);
    const rows = await api(customer).get('/api/v1/ktv-chat/threads').expect(200);
    expect(rows.body[0].can_send).toBe(false);
    await api(customer).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(200);
    accounts[0].chatEnabled = true;
    await db.query("UPDATE app_metadata SET value=$1::jsonb WHERE key='mocmaria.ktv.accounts.v1'", [
      JSON.stringify({ accounts }),
    ]);
    await db.query("UPDATE provider_applications SET status='SUSPENDED' WHERE id=$1", [providerId]);
    expect(
      ((await api().get('/api/v1/ktv-chat/providers').expect(200)).body as ChatProvider[]).map(
        (p: { id: string }) => p.id,
      ),
    ).not.toContain(providerId);
    await db.query("UPDATE provider_applications SET status='APPLIED' WHERE id=$1", [providerId]);
    await db.query('UPDATE users SET is_active=false WHERE id=$1', [providerUserId]);
    expect(
      ((await api().get('/api/v1/ktv-chat/providers').expect(200)).body as ChatProvider[]).map(
        (p: { id: string }) => p.id,
      ),
    ).not.toContain(providerId);
  });
});
