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
    for (let index = 0; index < 4; index++) {
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
          [id, index === 3 ? 'SUPER_ADMIN' : 'THERAPIST'],
        );
      const login = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3001')
        .send({ identifier: email, password })
        .expect(200);
      actors.push({ id, token: login.body.accessToken });
      if (index === 1 || index === 2) {
        const [row] = await db.query<Array<{ id: string }>>(
          "INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,$2,'APPROVED') RETURNING id",
          [id, 'KTV QA ' + index],
        );
        providers.push(row.id);
      }
    }
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
});
