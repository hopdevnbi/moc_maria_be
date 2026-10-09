/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Supertest responses are untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { ProvidersService } from '../src/modules/providers/providers.service';
import { requireIsolatedDatabase } from './isolated-database';

describe('Private KTV chat in disposable PostgreSQL', () => {
  let app: INestApplication, db: DataSource;
  const actors: Array<{ id: string; token: string }> = [];
  const providerIds: string[] = [];
  let threadId: string, messageId: string, lastMessageId: string;
  function api(index?: number): ReturnType<typeof request.agent> {
    const client = request.agent(app.getHttpServer());
    return index === undefined
      ? client
      : client.set('Authorization', 'Bearer ' + actors[index].token);
  }
  beforeAll(async () => {
    requireIsolatedDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 4; i++) {
      const response = await api()
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:3001')
        .send({
          email: `chat-${randomUUID()}@mocmaria.test`,
          displayName: `Isolated chat actor ${i}`,
          password: randomBytes(24).toString('base64url') + '1!',
        })
        .expect(201);
      actors.push({ id: response.body.user.id, token: response.body.accessToken });
    }
    for (const actor of actors.slice(1, 3)) {
      const [row] = await db.query<{ id: string }[]>(
        `INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,$2,'APPROVED') RETURNING id`,
        [actor.id, 'QA KTV'],
      );
      providerIds.push(row.id);
    }
    // Public eligibility is covered by catalog/provider suites. These fixtures test private chat with real auth and SQL.
    jest.spyOn(app.get(ProvidersService), 'publicProvider').mockImplementation((id) => {
      if (!providerIds.includes(id)) throw new Error('not public');
      return Promise.resolve({
        id,
        publicName: 'QA KTV',
        introduction: null,
        serviceArea: null,
        avatarUrl: null,
      } as Awaited<ReturnType<ProvidersService['publicProvider']>>);
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });
  it('requires authentication for listing and sending', async () => {
    await api().get('/api/v1/ktv-chat/threads').expect(401);
    await api()
      .post('/api/v1/ktv-chat/threads/' + randomUUID() + '/messages')
      .send({ body: 'hello' })
      .expect(401);
  });
  it('creates one thread for concurrent opens with the same KTV', async () => {
    const rows = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(0)
          .post('/api/v1/ktv-chat/threads')
          .send({ providerApplicationId: providerIds[0] })
          .expect(201),
      ),
    );
    expect(new Set(rows.map((row) => row.body.id)).size).toBe(1);
    threadId = rows[0].body.id;
  });
  it('creates separate conversations for another KTV and another customer', async () => {
    const second = await api(0)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerIds[1] })
      .expect(201);
    const other = await api(3)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerIds[0] })
      .expect(201);
    expect(second.body.id).not.toBe(threadId);
    expect(other.body.id).not.toBe(threadId);
  });
  it('rejects self chat, malformed UUID and group fields', async () => {
    await api(1)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerIds[0] })
      .expect(400);
    await api(0)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: 'demo' })
      .expect(400);
    await api(0)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerIds[0], memberUserIds: [actors[3].id] })
      .expect(400);
  });
  it('restricts listing to each participant', async () => {
    const list = await api(2).get('/api/v1/ktv-chat/threads').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).not.toBe(threadId);
    const own = await api(0).get('/api/v1/ktv-chat/threads').expect(200);
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect(own.body).toHaveLength(2);
  });
  it('blocks third-party reads, sends and read markers', async () => {
    await api(3).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(404);
    await api(3)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'intruder' })
      .expect(404);
    await api(3)
      .post(`/api/v1/ktv-chat/threads/${threadId}/read`)
      .send({ lastMessageId: randomUUID() })
      .expect(404);
  });
  it('rejects blank/oversized messages and sender spoofing', async () => {
    for (const body of ['   ', 'x'.repeat(2001)])
      await api(0).post(`/api/v1/ktv-chat/threads/${threadId}/messages`).send({ body }).expect(400);
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'hello', sender_user_id: actors[1].id })
      .expect(400);
  });
  it('deduplicates concurrent send retries and preserves original text', async () => {
    const clientMessageId = randomUUID();
    const rows = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(0)
          .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
          .send({ body: '  Xin chào 🌿  ', clientMessageId })
          .expect(201),
      ),
    );
    expect(new Set(rows.map((row) => row.body.id)).size).toBe(1);
    messageId = rows[0].body.id;
    expect(rows[0].body.sender_user_id).toBe(actors[0].id);
    expect(rows[0].body.body).toBe('Xin chào 🌿');
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'changed', clientMessageId })
      .expect(400);
  });
  it('KTV can reply; unread markers advance monotonically', async () => {
    const reply = await api(1)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'Chào bạn' })
      .expect(201);
    lastMessageId = reply.body.id;
    const list = await api(0).get('/api/v1/ktv-chat/threads').expect(200);
    expect(list.body.find((t: { id: string }) => t.id === threadId).unread_count).toBe(1);
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${threadId}/read`)
      .send({ lastMessageId })
      .expect(204);
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${threadId}/read`)
      .send({ lastMessageId: messageId })
      .expect(204);
    const after = await api(0).get('/api/v1/ktv-chat/threads').expect(200);
    expect(after.body.find((t: { id: string }) => t.id === threadId).unread_count).toBe(0);
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${threadId}/read`)
      .send({ lastMessageId: randomUUID() })
      .expect(400);
  });
  it('paginates more than 50 messages without losing chronological order', async () => {
    await db.query(
      `INSERT INTO ktv_chat_messages(thread_id,sender_user_id,client_message_id,body)
      SELECT $1,$2,gen_random_uuid(),'history '||n FROM generate_series(1,55) n`,
      [threadId, actors[1].id],
    );
    const latest = await api(0).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(200);
    expect(latest.body).toHaveLength(50);
    expect(latest.body.at(-1).body).toBe('history 55');
    const older = await api(0)
      .get(`/api/v1/ktv-chat/threads/${threadId}/messages?before=${latest.body[0].id}`)
      .expect(200);
    expect(older.body).toHaveLength(7);
    expect(older.body[0].id).toBe(messageId);
    expect(new Set([...older.body, ...latest.body].map((m) => m.id)).size).toBe(57);
  });
  it('rejects cursor/read marker from another conversation', async () => {
    const list = await api(0).get('/api/v1/ktv-chat/threads');
    const otherId = list.body.find((t: { id: string }) => t.id !== threadId).id;
    await api(0)
      .get(`/api/v1/ktv-chat/threads/${otherId}/messages?before=${messageId}`)
      .expect(400);
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${otherId}/read`)
      .send({ lastMessageId: messageId })
      .expect(400);
  });
  it('suspended KTV history remains private and sends are disabled', async () => {
    await db.query(`UPDATE provider_applications SET status='SUSPENDED' WHERE id=$1`, [
      providerIds[0],
    ]);
    await api(0).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(200);
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ body: 'new' })
      .expect(403);
  });
});
