/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- Supertest responses are untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { KtvChatService } from '../src/modules/ktv-chat/ktv-chat.service';
import { ZaloAlertsService } from '../src/modules/zalo-alerts/zalo-alerts.service';
import { requireIsolatedDatabase } from './isolated-database';

describe('KTV-specific Zalo and inquiry chat links on real isolated PostgreSQL', () => {
  let app: INestApplication, db: DataSource, inquiryId: string, threadId: string;
  const actors: Array<{ id: string; token: string }> = [];
  const providers: string[] = [];
  const clientId = randomUUID();
  const api = (index?: number): ReturnType<typeof request.agent> => {
    const agent = request.agent(app.getHttpServer());
    return index === undefined
      ? agent
      : agent.set('Authorization', 'Bearer ' + actors[index].token);
  };
  const booking = (index = 0): Record<string, unknown> => ({
    idempotencyKey: clientId,
    providerId: providers[index],
    serviceId: 'neck',
    location: 'AT_HOME',
    address: 'Địa chỉ thử nghiệm riêng trong DB QA',
    requestedAt: new Date(Date.now() + 86400000).toISOString(),
  });
  let firstBooking: Record<string, unknown>;
  async function deliveries(
    id: string,
  ): Promise<
    Array<{ key: string; value: { providerId?: string; recipient: string; text: string } }>
  > {
    return db.query(
      "SELECT key,value FROM app_metadata WHERE key LIKE 'mocmaria.zalo.%outbox.%' AND value->>'text' LIKE $1 ORDER BY key",
      ['%' + id + '%'],
    );
  }
  beforeAll(async () => {
    requireIsolatedDatabase();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let index = 0; index < 6; index++) {
      const email = randomUUID() + '@zalo-qa.test',
        password = randomBytes(24).toString('base64url') + '1!';
      const registered = await api()
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:3001')
        .send({
          email,
          password,
          displayName: index === 0 ? 'Khách 0912345678 mai@example.com' : 'KTV QA ' + index,
        })
        .expect(201);
      const id = registered.body.user.id;
      if (index > 0)
        await db.query(
          'INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2 ON CONFLICT DO NOTHING',
          [id, index === 3 ? 'SUPER_ADMIN' : index === 5 ? 'ADMIN' : 'THERAPIST'],
        );
      if (index > 0) {
        await db.query(
          "DELETE FROM user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM roles WHERE name='CUSTOMER')",
          [id],
        );
      }
      // The access guard resolves current roles from DB on every request.
      actors.push({ id, token: registered.body.accessToken });
      if (index === 1 || index === 5) {
        const me = await api(index).get('/api/v1/auth/me').expect(200);
        expect(me.body.permissions).not.toContain('customer.portal');
      }
      if (index === 1 || index === 2 || index === 4) {
        const [row] = await db.query<Array<{ id: string }>>(
          "INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,$2,'APPROVED') RETURNING id",
          [id, 'KTV QA ' + index],
        );
        providers.push(row.id);
      }
    }
    await db.query(
      'INSERT INTO staff_profiles(user_id,public_name,is_active,is_public) SELECT user_id,public_name,true,false FROM provider_applications',
    );
    const accounts = providers.map((applicationId, index) => ({
      applicationId,
      userId: actors[[1, 2, 4][index]].id,
      seedId: 'qa-ktv-' + index,
      chatEnabled: true,
    }));
    await db.query(
      "INSERT INTO app_metadata(key,value) VALUES('mocmaria.ktv.accounts.v1',$1::jsonb)",
      [JSON.stringify({ accounts })],
    );
    await db.query("INSERT INTO app_metadata(key,value) VALUES('mocmaria.demo.ktv.v1',$1::jsonb)", [
      JSON.stringify({
        profiles: accounts.map((a) => ({
          id: a.seedId,
          demoServices: [{ id: 'neck', name: 'Chăm sóc cổ vai gáy' }],
        })),
      }),
    ]);
    jest.spyOn(app.get(KtvChatService), 'directory').mockResolvedValue(
      providers.map((id, index) => ({
        id,
        publicName: 'KTV QA ' + index,
        title: 'KTV',
        serviceArea: null,
        avatarUrl: null,
        services: [{ id: 'neck', name: 'Chăm sóc cổ vai gáy' }],
      })),
    );
    const config = app.get(ConfigService);
    for (const [key, value] of Object.entries({
      ZALO_BOT_TOKEN: 'qa-main',
      ZALO_ADMIN_CHAT_IDS: 'qa-admin',
      ZALO_HOAN_BOT_TOKEN: 'qa-hoan',
      ZALO_HOAN_CHAT_IDS: 'qa-hoan',
      ZALO_LINH_DAN_BOT_TOKEN: 'qa-dan',
      ZALO_LINH_DAN_CHAT_IDS: 'qa-dan',
      ZALO_TIEN_MANH_BOT_TOKEN: 'qa-manh',
      ZALO_TIEN_MANH_CHAT_IDS: 'qa-manh',
      ZALO_TIEN_MANH_PROVIDER_ID: providers[0],
      ZALO_NGUYET_BOT_TOKEN: 'qa-nguyet',
      ZALO_NGUYET_CHAT_IDS: 'qa-nguyet',
      ZALO_NGUYET_PROVIDER_ID: providers[1],
      ZALO_THANH_THANH_BOT_TOKEN: 'qa-thanh-thanh',
      ZALO_THANH_THANH_CHAT_IDS: 'qa-thanh-thanh',
      ZALO_THANH_THANH_PROVIDER_ID: providers[2],
    }))
      config.set(key, value);
    firstBooking = booking();
  }, 60000);
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });
  it('persists one own-KTV notification plus all three admin channels on an actual booking', async () => {
    const response = await api(0)
      .post('/api/v1/appointment-inquiries')
      .send(firstBooking)
      .expect(201);
    inquiryId = response.body.id;
    expect(inquiryId).toMatch(/^[a-f0-9]{64}$/);
    const rows = await deliveries(inquiryId);
    expect(rows).toHaveLength(4);
    expect(rows.map((x) => x.value.recipient).sort()).toEqual([
      'qa-admin',
      'qa-dan',
      'qa-hoan',
      'qa-manh',
    ]);
    const own = rows.find((x) => x.value.recipient === 'qa-manh')!;
    expect(own.value.providerId).toBe(providers[0]);
    expect(own.value.text).toContain('/tin-nhan?inquiry=' + inquiryId);
    for (const row of rows) {
      expect(row.value.text).not.toContain('0912345678');
      expect(row.value.text).not.toContain('mai@example.com');
    }
    await api(0).post('/api/v1/appointment-inquiries').send(firstBooking).expect(201);
    expect(await deliveries(inquiryId)).toHaveLength(4);
  });
  it('only the assigned KTV can follow the booking link; admin and unrelated actors cannot', async () => {
    const url = '/api/v1/ktv-chat/inquiries/' + inquiryId + '/thread';
    await api().post(url).expect(401);
    for (const index of [0, 2, 3]) await api(index).post(url).expect(404);
    const a = await api(1).post(url).expect(201);
    const b = await api(1).post(url).expect(201);
    threadId = a.body.id;
    expect(b.body.id).toBe(threadId);
    expect(a.body.customer_user_id).toBe(actors[0].id);
    expect(a.body.provider_user_id).toBe(actors[1].id);
    expect(
      await db.query(
        'SELECT id FROM ktv_chat_threads WHERE customer_user_id=$1 AND provider_application_id=$2',
        [actors[0].id, providers[0]],
      ),
    ).toHaveLength(1);
    await api(1).post('/api/v1/ktv-chat/inquiries/not-an-id/thread').expect(404);
  });
  it('sends inbound customer chat to its KTV, hides contacts and deduplicates client retries', async () => {
    const message = { clientMessageId: randomUUID(), body: 'Xin chào 0912345678 mai@example.com' };
    const response = await api(0)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send(message)
      .expect(201);
    const rows = await deliveries(response.body.id);
    expect(rows).toHaveLength(4);
    expect(rows.map((x) => x.value.recipient)).not.toContain('qa-nguyet');
    expect(rows.find((x) => x.value.recipient === 'qa-manh')!.value.text).toContain(
      '/tin-nhan?thread=' + threadId,
    );
    for (const row of rows) {
      expect(row.value.text).not.toContain('0912345678');
      expect(row.value.text).not.toContain('mai@example.com');
    }
    await api(0).post(`/api/v1/ktv-chat/threads/${threadId}/messages`).send(message).expect(201);
    expect(await deliveries(response.body.id)).toHaveLength(4);
  });
  it('does not notify a KTV of their own reply while all admins keep receiving', async () => {
    const response = await api(1)
      .post(`/api/v1/ktv-chat/threads/${threadId}/messages`)
      .send({ clientMessageId: randomUUID(), body: 'Đã nhận yêu cầu của bạn.' })
      .expect(201);
    const rows = await deliveries(response.body.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => !x.key.includes('.staff.'))).toBe(true);
  });
  it('routes a different provider booking exclusively to that provider plus admins', async () => {
    const response = await api(0)
      .post('/api/v1/appointment-inquiries')
      .send({ ...booking(1), idempotencyKey: randomUUID() })
      .expect(201);
    const rows = await deliveries(response.body.id);
    expect(rows).toHaveLength(4);
    expect(rows.map((x) => x.value.recipient)).toContain('qa-nguyet');
    expect(rows.map((x) => x.value.recipient)).not.toContain('qa-manh');
  });
  it('covers an admin-created booking through the same scoped outbox contract', async () => {
    const { idempotencyKey: _unused, ...adminBooking } = booking(1);
    const response = await api(3)
      .post('/api/v1/admin/appointment-inquiries')
      .send({
        ...adminBooking,
        customerId: actors[0].id,
        reason: 'Tạo yêu cầu riêng cho kiểm thử DB cô lập.',
      })
      .expect(201);
    const rows = await deliveries(response.body.id);
    expect(rows).toHaveLength(4);
    expect(rows.map((x) => x.value.recipient)).toContain('qa-nguyet');
    expect(rows.map((x) => x.value.recipient)).not.toContain('qa-manh');
  });
  it('rolls back all outbox rows with a failed booking transaction', async () => {
    const eventId = 'cd'.repeat(32);
    await expect(
      db.transaction(async (manager) => {
        await app.get(ZaloAlertsService).enqueue(manager, {
          kind: 'inquiry',
          eventId,
          providerId: providers[0],
          providerName: 'KTV QA',
          customerName: 'Khách QA',
        });
        throw new Error('rollback-qa');
      }),
    ).rejects.toThrow('rollback-qa');
    expect(await deliveries(eventId)).toEqual([]);
  });
  it('routes Thanh Thanh bookings and incoming customer messages only to her bot plus admins', async () => {
    const input = { ...booking(2), idempotencyKey: randomUUID() };
    const inquiry = await api(0).post('/api/v1/appointment-inquiries').send(input).expect(201);
    const bookingRows = await deliveries(inquiry.body.id);
    expect(bookingRows.map((row) => row.value.recipient).sort()).toEqual([
      'qa-admin',
      'qa-dan',
      'qa-hoan',
      'qa-thanh-thanh',
    ]);
    expect(
      bookingRows.find((row) => row.value.recipient === 'qa-thanh-thanh')!.value.providerId,
    ).toBe(providers[2]);
    await api(1)
      .post('/api/v1/ktv-chat/inquiries/' + inquiry.body.id + '/thread')
      .expect(404);
    const thread = await api(4)
      .post('/api/v1/ktv-chat/inquiries/' + inquiry.body.id + '/thread')
      .expect(201);
    const incoming = await api(0)
      .post(`/api/v1/ktv-chat/threads/${thread.body.id}/messages`)
      .send({ clientMessageId: randomUUID(), body: 'Nhờ Thanh Thanh tư vấn giúp.' })
      .expect(201);
    expect((await deliveries(incoming.body.id)).map((row) => row.value.recipient).sort()).toEqual([
      'qa-admin',
      'qa-dan',
      'qa-hoan',
      'qa-thanh-thanh',
    ]);
    const reply = await api(4)
      .post(`/api/v1/ktv-chat/threads/${thread.body.id}/messages`)
      .send({ clientMessageId: randomUUID(), body: 'Đã nhận tin nhắn.' })
      .expect(201);
    expect((await deliveries(reply.body.id)).map((row) => row.value.recipient).sort()).toEqual([
      'qa-admin',
      'qa-dan',
      'qa-hoan',
    ]);
  });
  it('persists private pairing for every bot under the actual varchar100 database limit', async () => {
    for (const [slug, prefix] of [
      ['tien-manh', 'ZALO_TIEN_MANH'],
      ['nguyet', 'ZALO_NGUYET'],
      ['tung', 'ZALO_TUNG'],
      ['thanh-thanh', 'ZALO_THANH_THANH'],
    ]) {
      const secret = 'qa-pair-' + slug;
      app.get(ConfigService).set(prefix + '_WEBHOOK_SECRET', secret);
      const chatId = 'qa-private-' + slug;
      const event = {
        event_name: 'message.text.received',
        message: {
          from: { id: chatId, display_name: 'KTV QA', is_bot: false },
          chat: { id: chatId, chat_type: 'PRIVATE' },
          text: 'Kết nối Mộc Maria',
        },
      };
      await api()
        .post('/api/v1/zalo/ktv/' + slug + '/webhook')
        .set('X-Bot-Api-Secret-Token', secret)
        .send({ ...event, message: { ...event.message, text: '  kết   nối mộc maria  ' } })
        .expect(200);
      await api()
        .post('/api/v1/zalo/ktv/' + slug + '/webhook')
        .set('X-Bot-Api-Secret-Token', secret)
        .send(event)
        .expect(200);
      const rows = await db.query<Array<{ key: string; value: { chatId: string } }>>(
        'SELECT key,value FROM app_metadata WHERE key LIKE $1',
        ['mocmaria.zalo.staff.' + slug + '.pending.%'],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].key.length).toBeLessThanOrEqual(100);
      expect(rows[0].value.chatId).toBe(chatId);
    }
  });
  it.each([1, 5])(
    'lets a staff/admin account %s request another KTV under its own identity and chat',
    async (index) => {
      const input = { ...booking(2), idempotencyKey: randomUUID() };
      const created = await api(index)
        .post('/api/v1/appointment-inquiries')
        .send(input)
        .expect(201);
      expect(created.body.customerId).toBe(actors[index].id);
      expect(created.body.providerId).toBe(providers[2]);
      const notifications = await deliveries(created.body.id);
      expect(notifications.map((row) => row.value.recipient).sort()).toEqual([
        'qa-admin',
        'qa-dan',
        'qa-hoan',
        'qa-thanh-thanh',
      ]);
      const list = await api(index).get('/api/v1/appointment-inquiries').expect(200);
      expect((list.body as Array<{ id: string }>).some((row) => row.id === created.body.id)).toBe(
        true,
      );
      const thread = await api(index)
        .post('/api/v1/ktv-chat/threads')
        .send({ providerApplicationId: providers[2] })
        .expect(201);
      expect(thread.body.customer_user_id).toBe(actors[index].id);
      const sent = await api(index)
        .post(`/api/v1/ktv-chat/threads/${thread.body.id}/messages`)
        .send({ clientMessageId: randomUUID(), body: 'Tôi muốn trao đổi về lịch vừa đặt.' })
        .expect(201);
      expect((await deliveries(sent.body.id)).map((row) => row.value.recipient).sort()).toEqual([
        'qa-admin',
        'qa-dan',
        'qa-hoan',
        'qa-thanh-thanh',
      ]);
      const unrelated = await api(2).get('/api/v1/ktv-chat/threads').expect(200);
      expect(
        (unrelated.body as Array<{ id: string }>).some((row) => row.id === thread.body.id),
      ).toBe(false);
      await api(2)
        .patch('/api/v1/appointment-inquiries/' + created.body.id)
        .send({ status: 'CANCELLED' })
        .expect(404);
      await api(index)
        .patch('/api/v1/appointment-inquiries/' + created.body.id)
        .send({ status: 'CANCELLED' })
        .expect(200);
    },
  );
  it('rejects self-booking, self-chat and a caller-supplied customer identity', async () => {
    await api(1)
      .post('/api/v1/appointment-inquiries')
      .send({ ...booking(0), idempotencyKey: randomUUID() })
      .expect(400);
    await api(1)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: providers[0] })
      .expect(400);
    await api(5)
      .post('/api/v1/appointment-inquiries')
      .send({ ...booking(2), idempotencyKey: randomUUID(), customerId: actors[0].id })
      .expect(400);
  });
  it('opens an exact inquiry for super admin support, keeps honest message identity and preserves participant read/block state', async () => {
    const entry = '/api/v1/ktv-chat/inquiries/' + inquiryId + '/support-thread';
    const messages = `/api/v1/ktv-chat/threads/${threadId}/messages`;
    await api(3).get(messages).expect(404);
    for (const index of [0, 1, 2, 5]) await api(index).post(entry).expect(403);
    const opened = await api(3).post(entry).expect(201);
    expect(opened.body.id).toBe(threadId);
    expect(opened.body.support_access).toBe(true);
    await api(3).post('/api/v1/ktv-chat/inquiries/invalid/support-thread').expect(404);
    const before = await db.query(
      'SELECT customer_read_seq,provider_read_seq FROM ktv_chat_threads WHERE id=$1',
      [threadId],
    );
    const payload = {
      clientMessageId: randomUUID(),
      body: 'Quản trị hỗ trợ khách và KTV trong DB QA.',
    };
    const sent = await api(3).post(messages).send(payload).expect(201);
    expect(sent.body.sender_user_id).toBe(actors[3].id);
    expect(sent.body.sender_is_support).toBe(true);
    expect(sent.body.sender_name).toBe('KTV QA 3');
    for (const index of [0, 1, 3]) {
      const history = await api(index).get(messages).expect(200);
      expect(
        (history.body as Array<{ id: string; sender_is_support: boolean }>).find(
          (m) => m.id === sent.body.id,
        )?.sender_is_support,
      ).toBe(true);
    }
    const retry = await api(3).post(messages).send(payload).expect(201);
    expect(retry.body.id).toBe(sent.body.id);
    expect((await deliveries(sent.body.id)).map((row) => row.value.recipient).sort()).toEqual([
      'qa-admin',
      'qa-dan',
      'qa-hoan',
    ]);
    for (const delivery of await deliveries(sent.body.id)) {
      expect(delivery.value.text).toContain('/tin-nhan?thread=' + threadId + '&support=1');
      expect(delivery.value.text).toContain('Quản trị hỗ trợ');
    }
    await api(3)
      .post(`/api/v1/ktv-chat/threads/${threadId}/read`)
      .send({ lastMessageId: sent.body.id })
      .expect(204);
    const after = await db.query(
      'SELECT customer_read_seq,provider_read_seq FROM ktv_chat_threads WHERE id=$1',
      [threadId],
    );
    expect(after).toEqual(before);
    await api(3)
      .post(`/api/v1/ktv-chat/threads/${threadId}/block`)
      .send({ mode: 'PERMANENT' })
      .expect(403);
    await api(3).post(`/api/v1/ktv-chat/threads/${threadId}/unblock`).expect(403);
    await api(2).get(messages).expect(404);
    const audits = await db.query<Array<{ count: number }>>(
      "SELECT count(*)::int count FROM audit_logs WHERE actor_user_id=$1 AND event='KTV_CHAT_SUPPORT_MESSAGE' AND metadata->>'messageId'=$2",
      [actors[3].id, sent.body.id],
    );
    expect(audits[0].count).toBe(1);
  });
  it('checks support grant expiry, live role revocation, blocked and protected threads without changing customer controls', async () => {
    const entry = `/api/v1/ktv-chat/inquiries/support/threads/${threadId}`;
    const messages = `/api/v1/ktv-chat/threads/${threadId}/messages`;
    const key = `mocmaria.chat.support.${threadId}.${actors[3].id}`;
    expect(key.length).toBeLessThanOrEqual(100);
    await db.query(
      "UPDATE app_metadata SET value=jsonb_set(value,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE key=$1",
      [key],
    );
    await api(3).get(messages).expect(404);
    await api(3).post(entry).expect(201);
    await db.query(
      "DELETE FROM user_roles WHERE user_id=$1 AND role_id=(SELECT id FROM roles WHERE name='SUPER_ADMIN')",
      [actors[3].id],
    );
    try {
      await api(3).get(messages).expect(404);
      await api(3).post(entry).expect(403);
    } finally {
      await db.query(
        "INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='SUPER_ADMIN' ON CONFLICT DO NOTHING",
        [actors[3].id],
      );
    }
    await api(1)
      .post(`/api/v1/ktv-chat/threads/${threadId}/block`)
      .send({ mode: 'PERMANENT' })
      .expect(201);
    try {
      await api(3)
        .post(messages)
        .send({ body: 'Cannot bypass block', clientMessageId: randomUUID() })
        .expect(403);
    } finally {
      await api(1).post(`/api/v1/ktv-chat/threads/${threadId}/unblock`).expect(201);
    }
    const privacyKey = 'mocmaria.chat.privacy.' + threadId;
    await db.query(
      'INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
      [privacyKey, JSON.stringify({ passwordHash: 'qa-protected', failures: 0, grants: {} })],
    );
    try {
      await api(3).get(messages).expect(404);
      await api(3).post(entry).expect(403);
      const list = await api(3).get('/api/v1/ktv-chat/threads').expect(200);
      expect((list.body as Array<{ id: string }>).some((row) => row.id === threadId)).toBe(false);
      await api(1).get(messages).expect(200);
    } finally {
      await db.query('DELETE FROM app_metadata WHERE key=$1', [privacyKey]);
    }
  });
});
