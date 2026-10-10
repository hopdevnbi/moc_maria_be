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
  const actors: Array<{ id: string; token: string; email: string; password: string }> = [];
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
      const email = `chat-${randomUUID()}@mocmaria.test`;
      const password = randomBytes(24).toString('base64url') + '1!';
      const response = await api()
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:3001')
        .send({
          email,
          displayName: `Isolated chat actor ${i}`,
          password,
        })
        .expect(201);
      actors.push({ id: response.body.user.id, token: response.body.accessToken, email, password });
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
  it('enforces participant-only block/unblock and validates durations', async () => {
    const path = `/api/v1/ktv-chat/threads/${threadId}`;
    await api()
      .post(path + '/block')
      .send({ mode: 'PERMANENT' })
      .expect(401);
    await api(3)
      .post(path + '/block')
      .send({ mode: 'PERMANENT' })
      .expect(404);
    await api(3)
      .post(path + '/unblock')
      .send({})
      .expect(404);
    for (const body of [
      { mode: 'TEMPORARY' },
      { mode: 'TEMPORARY', durationMinutes: 0 },
      { mode: 'TEMPORARY', durationMinutes: 1.5 },
      { mode: 'TEMPORARY', durationMinutes: 525601 },
      { mode: 'PERMANENT', durationMinutes: 60 },
      { mode: 'PERMANENT', blocker_user_id: actors[1].id },
    ])
      await api(0)
        .post(path + '/block')
        .send(body)
        .expect(400);
  });
  it('KTV blocks both sends but preserves history, private notes and separate conversations', async () => {
    const path = `/api/v1/ktv-chat/threads/${threadId}`;
    const blocked = await api(1)
      .post(path + '/block')
      .send({ mode: 'PERMANENT', reason: 'private reason' })
      .expect(201);
    expect(blocked.body).toMatchObject({
      blocked_by_me: true,
      blocked_by_other: false,
      can_send: false,
      my_block_expires_at: null,
    });
    for (const actor of [0, 1])
      await api(actor)
        .post(path + '/messages')
        .send({ body: 'cannot send' })
        .expect(403);
    await api(0)
      .get(path + '/messages')
      .expect(200);
    const list = await api(0).get('/api/v1/ktv-chat/threads').expect(200);
    expect(list.body.find((t: { id: string }) => t.id === threadId)).toMatchObject({
      blocked_by_me: false,
      blocked_by_other: true,
      can_send: false,
    });
    expect(JSON.stringify(list.body)).not.toContain('private reason');
    const separate = list.body.find((t: { id: string }) => t.id !== threadId);
    await api(0)
      .post(`/api/v1/ktv-chat/threads/${separate.id}/messages`)
      .send({ body: 'unaffected' })
      .expect(201);
    const reopened = await api(0)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providerIds[0] })
      .expect(201);
    expect(reopened.body).toMatchObject({ id: threadId, can_send: false });
  });
  it('each participant can only lift their own block; temporary blocks expire automatically', async () => {
    const path = `/api/v1/ktv-chat/threads/${threadId}`;
    await api(0)
      .post(path + '/block')
      .send({ mode: 'TEMPORARY', durationMinutes: 60 })
      .expect(201);
    const ownLift = await api(0)
      .post(path + '/unblock')
      .send({})
      .expect(201);
    expect(ownLift.body).toMatchObject({
      blocked_by_me: false,
      blocked_by_other: true,
      can_send: false,
    });
    await api(0)
      .post(path + '/block')
      .send({ mode: 'TEMPORARY', durationMinutes: 60 })
      .expect(201);
    const peerLift = await api(1)
      .post(path + '/unblock')
      .send({})
      .expect(201);
    expect(peerLift.body).toMatchObject({
      blocked_by_me: false,
      blocked_by_other: true,
      can_send: false,
    });
    await db.query(
      `UPDATE ktv_chat_blocks SET expires_at=clock_timestamp()-interval '1 second' WHERE thread_id=$1 AND blocker_user_id=$2`,
      [threadId, actors[0].id],
    );
    const list = await api(0).get('/api/v1/ktv-chat/threads').expect(200);
    expect(list.body.find((t: { id: string }) => t.id === threadId)).toMatchObject({
      blocked_by_me: false,
      blocked_by_other: false,
      can_send: true,
    });
    await api(0)
      .post(path + '/messages')
      .send({ body: 'automatically reopened' })
      .expect(201);
  });
  describe('customer per-thread password', () => {
    const password = 'Private chat passphrase 1!';
    const nextPassword = 'Another private passphrase 2!';
    const privacyPath = (): string => `/api/v1/ktv-chat/threads/${threadId}/privacy`;
    const metadataKey = (): string => `mocmaria.chat.privacy.${threadId}`;
    beforeAll(async () => {
      // Pagination fixtures must not exhaust the real 30/min provider send limit.
      await db.query(
        `UPDATE ktv_chat_messages SET created_at=now()-interval '2 minutes'
         WHERE thread_id=$1 AND body LIKE 'history %'`,
        [threadId],
      );
    });
    afterEach(async () => {
      await db.query('DELETE FROM app_metadata WHERE key=$1', [metadataKey()]);
    });
    it('only the owning customer may configure a password and rejects malformed inputs', async () => {
      await api()
        .post(privacyPath() + '/password')
        .send({ password })
        .expect(401);
      await api(1)
        .post(privacyPath() + '/password')
        .send({ password })
        .expect(403);
      await api(3)
        .post(privacyPath() + '/password')
        .send({ password })
        .expect(404);
      await api(0)
        .post(privacyPath() + '/password')
        .send({ password: 'short' })
        .expect(400);
      await api(0)
        .post(privacyPath() + '/password')
        .send({ password, customer_user_id: actors[3].id })
        .expect(400);
    });
    it('masks previews and gates history, sending, retry and read; the KTV stays unaffected', async () => {
      const set = await api(0)
        .post(privacyPath() + '/password')
        .send({ password })
        .expect(201);
      expect(set.body).toMatchObject({
        privacy_enabled: true,
        history_locked: false,
        last_message: null,
      });
      expect(JSON.stringify(set.body)).not.toMatch(/passwordHash|grants|failures/);
      const [stored] = await db.query('SELECT value FROM app_metadata WHERE key=$1', [
        metadataKey(),
      ]);
      expect(stored.value.passwordHash).toMatch(/^\$argon2id\$/);
      expect(JSON.stringify(stored.value)).not.toContain(password);
      expect(JSON.stringify(stored.value)).not.toContain(set.body.unlock_token);
      await api(0).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(403);
      await api(0)
        .get(`/api/v1/ktv-chat/threads/${threadId}/messages`)
        .set('X-Chat-Unlock', set.body.unlock_token)
        .expect(200);
      const lock = await api(0)
        .post(privacyPath() + '/lock')
        .send({})
        .expect(201);
      expect(lock.body).toMatchObject({ history_locked: true, last_message: null });
      const path = `/api/v1/ktv-chat/threads/${threadId}`;
      const history = await api(0)
        .get(path + '/messages')
        .expect(403);
      expect(history.body.error).toBe('CHAT_LOCKED');
      await api(0)
        .post(path + '/read')
        .send({ lastMessageId: messageId })
        .expect(403);
      await api(0)
        .post(path + '/messages')
        .send({ body: 'locked send', clientMessageId: randomUUID() })
        .expect(403);
      await api(1)
        .get(path + '/messages')
        .expect(200);
      await api(1)
        .post(path + '/messages')
        .send({ body: 'provider reply while customer locked' })
        .expect(201);
      const provider = await api(1).get('/api/v1/ktv-chat/threads').expect(200);
      expect(provider.body.find((t: { id: string }) => t.id === threadId)).toMatchObject({
        privacy_enabled: false,
        history_locked: false,
        last_message: 'provider reply while customer locked',
      });
      const customer = await api(0).get('/api/v1/ktv-chat/threads').expect(200);
      expect(customer.body.find((t: { id: string }) => t.id === threadId).last_message).toBeNull();
    });
    it('unlock is session scoped, expires, and does not unlock another protected chat', async () => {
      await api(0)
        .post(privacyPath() + '/password')
        .send({ password })
        .expect(201);
      const login = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3001')
        .send({ identifier: actors[0].email, password: actors[0].password })
        .expect(200);
      const session = request
        .agent(app.getHttpServer())
        .set('Authorization', 'Bearer ' + login.body.accessToken);
      const locked = await session.get('/api/v1/ktv-chat/threads').expect(200);
      expect(locked.body.find((t: { id: string }) => t.id === threadId).history_locked).toBe(true);
      await session.get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(403);
      await session
        .post(privacyPath() + '/unlock')
        .send({ password: 'wrong' })
        .expect(403);
      const unlocked = await session
        .post(privacyPath() + '/unlock')
        .send({ password })
        .expect(201);
      await session.get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(403);
      session.set('X-Chat-Unlock', unlocked.body.unlock_token);
      await session.get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(200);
      const otherId = locked.body.find((t: { id: string }) => t.id !== threadId).id;
      await api(0)
        .post(`/api/v1/ktv-chat/threads/${otherId}/privacy/password`)
        .send({ password: nextPassword })
        .expect(201);
      await session.get(`/api/v1/ktv-chat/threads/${otherId}/messages`).expect(403);
      await db.query(
        `UPDATE app_metadata SET value=jsonb_set(value,ARRAY['grants',$2::text,'expiresAt'],to_jsonb(1::bigint)) WHERE key=$1`,
        [metadataKey(), login.body.user.sessionId],
      );
      await session.get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(403);
      await db.query('DELETE FROM app_metadata WHERE key=$1', [`mocmaria.chat.privacy.${otherId}`]);
    });
    it('persists failed attempts, limits guesses and validates old password for changes/removal', async () => {
      await api(0)
        .post(privacyPath() + '/password')
        .send({ password })
        .expect(201);
      await api(0)
        .post(privacyPath() + '/lock')
        .send({})
        .expect(201);
      for (let i = 0; i < 5; i++)
        await api(0)
          .post(privacyPath() + '/unlock')
          .send({ password: 'wrong' })
          .expect(i === 4 ? 429 : 403);
      await api(0)
        .post(privacyPath() + '/unlock')
        .send({ password })
        .expect(429);
      const [stored] = await db.query('SELECT value FROM app_metadata WHERE key=$1', [
        metadataKey(),
      ]);
      expect(stored.value.blockedUntil).toBeGreaterThan(Date.now());
      await db.query(`UPDATE app_metadata SET value=value-'blockedUntil' WHERE key=$1`, [
        metadataKey(),
      ]);
      await api(0)
        .post(privacyPath() + '/password')
        .send({ password: nextPassword, currentPassword: 'wrong' })
        .expect(403);
      await api(0)
        .post(privacyPath() + '/password')
        .send({ password: nextPassword, currentPassword: password })
        .expect(201);
      await api(0)
        .post(privacyPath() + '/unlock')
        .send({ password })
        .expect(403);
      await api(0)
        .post(privacyPath() + '/remove')
        .send({ password: 'wrong' })
        .expect(403);
      const removed = await api(0)
        .post(privacyPath() + '/remove')
        .send({ password: nextPassword })
        .expect(201);
      expect(removed.body).toMatchObject({ privacy_enabled: false, history_locked: false });
      await api(0).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(200);
    });
    it('recovers only with the owner account password, preserves history and never logs secrets', async () => {
      await api(0)
        .post(privacyPath() + '/password')
        .send({ password })
        .expect(201);
      await api(0)
        .post(privacyPath() + '/lock')
        .send({})
        .expect(201);
      await api(1)
        .post(privacyPath() + '/recover')
        .send({ password: actors[1].password })
        .expect(403);
      await api(3)
        .post(privacyPath() + '/recover')
        .send({ password: actors[3].password })
        .expect(404);
      await api(0)
        .post(privacyPath() + '/recover')
        .send({ password: actors[3].password })
        .expect(403);
      await api(0)
        .post(privacyPath() + '/recover')
        .send({ password: actors[0].password })
        .expect(201);
      const history = await api(0).get(`/api/v1/ktv-chat/threads/${threadId}/messages`).expect(200);
      expect(history.body.length).toBeGreaterThan(0);
      const [preserved] = await db.query(
        'SELECT id FROM ktv_chat_messages WHERE thread_id=$1 AND id=$2',
        [threadId, messageId],
      );
      expect(preserved.id).toBe(messageId);
      const audit = await db.query(
        `SELECT metadata FROM audit_logs WHERE event LIKE 'KTV_CHAT_PRIVACY_%' AND actor_user_id=$1`,
        [actors[0].id],
      );
      expect(JSON.stringify(audit)).not.toMatch(/passwordHash|grants/);
      expect(JSON.stringify(audit)).not.toContain(password);
      expect(JSON.stringify(audit)).not.toContain(actors[0].password);
    });
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
