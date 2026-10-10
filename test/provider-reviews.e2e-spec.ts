/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Supertest JSON is untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { ProvidersService } from '../src/modules/providers/providers.service';
import { requireIsolatedDatabase } from './isolated-database';

describe('Verified provider reviews in disposable PostgreSQL', () => {
  let app: INestApplication,
    db: DataSource,
    provider: string,
    otherProvider: string,
    branch: string,
    completed: string,
    pending: string,
    ownService: string,
    reviewId: string;
  const actors: Array<{ id: string; token: string }> = [];
  const api = (index?: number): ReturnType<typeof request.agent> => {
    const agent = request.agent(app.getHttpServer());
    return index === undefined
      ? agent
      : agent.set('Authorization', 'Bearer ' + actors[index].token);
  };
  async function booking(owner: number, status = 'COMPLETED', ktv = provider): Promise<string> {
    const [row] = await db.query<{ id: string }[]>(
      `INSERT INTO appointments(customer_user_id,created_by,branch_id,mode,status,starts_at,ends_at,blocked_starts_at,blocked_ends_at,request_expires_at,idempotency_key,request_fingerprint,source)
    VALUES($1,$1,$2,'AT_BRANCH',$3,now()-interval '2 days',now()-interval '1 day',now()-interval '2 days',now()-interval '1 day',now()-interval '3 days',$4,$5,'WEB') RETURNING id`,
      [actors[owner].id, branch, status, randomUUID(), 'a'.repeat(64)],
    );
    await db.query(
      'INSERT INTO appointment_staff(appointment_id,provider_application_id) VALUES($1,$2)',
      [row.id, ktv],
    );
    return row.id;
  }
  const payload = (): {
    appointmentId: string;
    providerApplicationId: string;
    stars: number;
    comment: string;
  } => ({
    appointmentId: completed,
    providerApplicationId: provider,
    stars: 5,
    comment: 'Dịch vụ chu đáo.',
  });
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
          email: `reviews-${randomUUID()}@mocmaria.test`,
          displayName: `Private reviewer ${i}`,
          password: randomBytes(24).toString('base64url') + '1!',
        })
        .expect(201);
      actors.push({ id: response.body.user.id, token: response.body.accessToken });
    }
    const [p] = await db.query<{ id: string }[]>(
      `INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,'QA provider','APPROVED') RETURNING id`,
      [actors[1].id],
    );
    provider = p.id;
    const [p2] = await db.query<{ id: string }[]>(
      `INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,'QA second provider','APPROVED') RETURNING id`,
      [actors[2].id],
    );
    otherProvider = p2.id;
    const [b] = await db.query<{ id: string }[]>(
      `INSERT INTO branches(name,code,address) VALUES('QA branch',$1,'Private QA address') RETURNING id`,
      [randomUUID()],
    );
    branch = b.id;
    completed = await booking(0);
    pending = await booking(0, 'CONFIRMED');
    ownService = await booking(1);
    const publicRow = {
      id: provider,
      publicName: 'QA provider',
      introduction: null,
      serviceArea: null,
      avatarUrl: null,
    } as Awaited<ReturnType<ProvidersService['publicProvider']>>;
    jest.spyOn(app.get(ProvidersService), 'publicProvider').mockResolvedValue(publicRow);
    jest
      .spyOn(app.get(ProvidersService), 'publicProviders')
      .mockResolvedValue([publicRow, { ...publicRow, id: otherProvider }]);
    await db.query(
      `INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='SUPER_ADMIN' ON CONFLICT DO NOTHING`,
      [actors[3].id],
    );
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });
  it('rejects unauthenticated, unrelated, uncompleted, wrong KTV and self reviews', async () => {
    await api().post('/api/v1/provider-reviews').send(payload()).expect(401);
    await api(2).post('/api/v1/provider-reviews').send(payload()).expect(403);
    await api(0)
      .post('/api/v1/provider-reviews')
      .send({ ...payload(), appointmentId: pending })
      .expect(403);
    await api(0)
      .post('/api/v1/provider-reviews')
      .send({ ...payload(), providerApplicationId: otherProvider })
      .expect(403);
    await api(1)
      .post('/api/v1/provider-reviews')
      .send({ ...payload(), appointmentId: ownService })
      .expect(403);
  });
  it('validates stars, text and identity fields, and lists only own completed bookings', async () => {
    for (const body of [
      { stars: 0 },
      { stars: 6 },
      { stars: 1.5 },
      { comment: '   ' },
      { comment: 'x'.repeat(2001) },
      { customerUserId: actors[2].id },
    ])
      await api(0)
        .post('/api/v1/provider-reviews')
        .send({ ...payload(), ...body })
        .expect(400);
    const list = await api(0).get('/api/v1/provider-reviews/me/eligible').expect(200);
    expect(list.body.map((item: { appointment_id: string }) => item.appointment_id)).toEqual([
      completed,
    ]);
    expect((await api(1).get('/api/v1/provider-reviews/me/eligible').expect(200)).body).toEqual([]);
    const empty = await api().get(`/api/v1/providers/${provider}/reviews`).expect(200);
    expect(empty.body.summary).toMatchObject({ average: null, count: 0 });
  });
  it('creates one verified review/history under concurrent retries', async () => {
    const rows = await Promise.all(
      Array.from({ length: 4 }, () =>
        api(0).post('/api/v1/provider-reviews').send(payload()).expect(201),
      ),
    );
    expect(new Set(rows.map((row) => row.body.id)).size).toBe(1);
    reviewId = rows[0].body.id;
    const [count] = await db.query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM provider_review_history WHERE review_id=$1',
      [reviewId],
    );
    expect(count.count).toBe(1);
    await api(0)
      .post('/api/v1/provider-reviews')
      .send({ ...payload(), stars: 3 })
      .expect(409);
  });
  it('publishes genuine scores and comments without customer identity or booking details', async () => {
    const before = await api()
      .get('/api/v1/providers/' + provider + '/reviews')
      .expect(200);
    expect(before.body.summary).toMatchObject({ average: null, count: 0 });
    expect(before.body.items).toEqual([]);
    await api(0).get('/api/v1/admin/provider-reviews?status=PENDING').expect(403);
    const pendingQueue = await api(3)
      .get('/api/v1/admin/provider-reviews?status=PENDING')
      .expect(200);
    expect(pendingQueue.body.items).toContainEqual(
      expect.objectContaining({
        id: reviewId,
        moderation_status: 'PENDING',
        stars: 5,
      }),
    );
    await api(3)
      .patch('/api/v1/admin/provider-reviews/' + reviewId + '/visibility')
      .send({
        visibility: 'PUBLISHED',
        reason: 'Verified review passed independent check',
        expectedVersion: 1,
      })
      .expect(200);

    const page = await api().get(`/api/v1/providers/${provider}/reviews`).expect(200);
    expect(page.body.summary).toMatchObject({ average: 5, count: 1, distribution: { '5': 1 } });
    expect(page.body.items[0]).toMatchObject({
      stars: 5,
      comment: 'Dịch vụ chu đáo.',
      author_label: 'Khách đã sử dụng dịch vụ',
    });
    for (const secret of [actors[0].id, 'Private reviewer', completed, 'Private QA address'])
      expect(JSON.stringify(page.body)).not.toContain(secret);
    const ratings = await api().get('/api/v1/provider-reviews/public/ratings').expect(200);
    expect(ratings.body[provider]).toEqual({ average: 5, count: 1 });
    expect(ratings.body[otherProvider]).toEqual({ average: null, count: 0 });
  });
  it('blocks do not prevent a valid review edit or erase feedback', async () => {
    const thread = await api(0)
      .post('/api/v1/ktv-chat/threads')
      .send({ providerApplicationId: provider })
      .expect(201);
    await api(1)
      .post(`/api/v1/ktv-chat/threads/${thread.body.id}/block`)
      .send({ mode: 'PERMANENT' })
      .expect(201);
    const edit = await api(0)
      .patch(`/api/v1/provider-reviews/${reviewId}`)
      .send({ stars: 4, comment: 'Dịch vụ tốt, có thể đúng giờ hơn.', expectedVersion: 2 })
      .expect(200);
    expect(edit.body).toMatchObject({ version: 3, stars: 4 });
    await api(0)
      .patch(`/api/v1/provider-reviews/${reviewId}`)
      .send({ stars: 3, comment: 'stale', expectedVersion: 2 })
      .expect(403);
    await api(2)
      .patch(`/api/v1/provider-reviews/${reviewId}`)
      .send({ stars: 1, comment: 'intruder', expectedVersion: 3 })
      .expect(404);
    const page = await api().get(`/api/v1/providers/${provider}/reviews`).expect(200);
    expect(page.body.summary.count).toBe(0);
    const queue = await api(3).get('/api/v1/admin/provider-reviews?status=PENDING').expect(200);
    expect(queue.body.items).toContainEqual(expect.objectContaining({ id: reviewId, stars: 4 }));
    await api(3)
      .patch('/api/v1/admin/provider-reviews/' + reviewId + '/visibility')
      .send({
        visibility: 'PUBLISHED',
        reason: 'Edited review checked independently',
        expectedVersion: 3,
      })
      .expect(200);
    const visible = await api()
      .get('/api/v1/providers/' + provider + '/reviews')
      .expect(200);
    expect(visible.body.summary.average).toBe(4);
  });
  it('allows only independent moderation with a reason and auditable history', async () => {
    const path = `/api/v1/admin/provider-reviews/${reviewId}/visibility`;
    await api(1)
      .patch(path)
      .send({ visibility: 'HIDDEN', reason: 'KTV wants to hide', expectedVersion: 4 })
      .expect(403);
    await db.query(
      `INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='SUPER_ADMIN' ON CONFLICT DO NOTHING`,
      [actors[1].id],
    );
    await api(1)
      .patch(path)
      .send({ visibility: 'HIDDEN', reason: 'KTV wants to hide', expectedVersion: 4 })
      .expect(403);
    await api(3)
      .patch(path)
      .send({ visibility: 'HIDDEN', reason: 'short', expectedVersion: 4 })
      .expect(400);
    const moderated = await api(3)
      .patch(path)
      .send({
        visibility: 'HIDDEN',
        reason: 'Independent QA moderation reason',
        expectedVersion: 4,
      })
      .expect(200);
    expect(moderated.body.version).toBe(5);
    const page = await api().get(`/api/v1/providers/${provider}/reviews`).expect(200);
    expect(page.body.summary).toMatchObject({ average: null, count: 0 });
    expect(page.body.items).toEqual([]);
    await api(0)
      .patch(`/api/v1/provider-reviews/${reviewId}`)
      .send({ stars: 5, comment: 'overwrite moderation', expectedVersion: 5 })
      .expect(403);
    await api(3)
      .patch(path)
      .send({
        visibility: 'PUBLISHED',
        reason: 'Review restored after QA check',
        expectedVersion: 5,
      })
      .expect(200);
    const history = await db.query<{ action: string }[]>(
      'SELECT action FROM provider_review_history WHERE review_id=$1 ORDER BY version',
      [reviewId],
    );
    expect(history.map((row) => row.action)).toEqual([
      'CREATE',
      'MODERATE',
      'EDIT',
      'MODERATE',
      'MODERATE',
      'MODERATE',
    ]);
  });
  it('enforces the seven-day edit window', async () => {
    await db.query(
      `UPDATE provider_reviews SET created_at=clock_timestamp()-interval '8 days' WHERE id=$1`,
      [reviewId],
    );
    await api(0)
      .patch(`/api/v1/provider-reviews/${reviewId}`)
      .send({ stars: 5, comment: 'too late', expectedVersion: 6 })
      .expect(403);
  });
});
