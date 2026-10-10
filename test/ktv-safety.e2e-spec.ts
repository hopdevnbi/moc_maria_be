/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Supertest responses are untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { requireIsolatedDatabase } from './isolated-database';
import { KtvSafetyService } from '../src/modules/ktv-safety/safety.service';
describe('KTV safety isolated PostgreSQL', () => {
  let app: INestApplication, db: DataSource, sessionId: string, alertId: string;
  const actors: Array<{ id: string; token: string }> = [],
    inquiryId = randomBytes(32).toString('hex');
  function api(i?: number): ReturnType<typeof request.agent> {
    const r = request.agent(app.getHttpServer());
    return i === undefined ? r : r.set('Authorization', 'Bearer ' + actors[i].token);
  }
  const start = (): import('../src/modules/ktv-safety/safety.dto').StartSafetyDto => ({
    inquiryId,
    consent: true,
    expectedCheckAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const point = (): import('../src/modules/ktv-safety/safety.dto').SafetyPointDto => ({
    latitude: 21.01234,
    longitude: 105.81234,
    accuracy: 17,
    recordedAt: new Date().toISOString(),
  });
  beforeAll(async () => {
    requireIsolatedDatabase();
    process.env['KTV_SAFETY_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 4; i++) {
      const email = `safety-${randomUUID()}@mocmaria.test`,
        password = randomBytes(24).toString('base64url') + '1!';
      const r = await api()
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:3001')
        .send({ email, password, displayName: 'Safety QA ' + i })
        .expect(201);
      const id = r.body.user.id;
      if (i > 0)
        await db.query(
          `INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2 ON CONFLICT DO NOTHING`,
          [id, i === 2 ? 'SUPER_ADMIN' : 'THERAPIST'],
        );
      const login = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3001')
        .send({ identifier: email, password })
        .expect(200);
      actors.push({ id, token: login.body.accessToken });
    }
    await db.query(`INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)`, [
      'mocmaria.inquiry.' + inquiryId,
      JSON.stringify({
        id: inquiryId,
        providerUserId: actors[1].id,
        providerName: 'QA KTV',
        customerId: actors[0].id,
        customerName: 'QA customer',
        serviceName: 'QA massage',
        address: '12 Nguyễn Trãi, Hà Nội',
        location: 'AT_HOME',
        status: 'CONTACTED',
      }),
    ]);
  });
  afterAll(async () => {
    await app?.close();
    delete process.env['KTV_SAFETY_ENCRYPTION_KEY'];
  });
  it('denies guests/customers/other KTVs and requires opt-in', async () => {
    await api().get('/api/v1/ktv-safety/monitor').expect(401);
    await api(0).get('/api/v1/ktv-safety/monitor').expect(403);
    await api(1).get('/api/v1/ktv-safety/monitor').expect(403);
    await api(0).get('/api/v1/ktv-safety/me').expect(403);
    await api(3).post('/api/v1/ktv-safety').send(start()).expect(404);
    await api(1)
      .post('/api/v1/ktv-safety')
      .send({ ...start(), consent: false })
      .expect(400);
  });
  it('allows only one concurrent session and encrypts visit context and GPS', async () => {
    const responses = await Promise.all([
      api(1).post('/api/v1/ktv-safety').send(start()),
      api(1).post('/api/v1/ktv-safety').send(start()),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    sessionId = responses.find((r) => r.status === 201)!.body.id;
    await api(3)
      .post('/api/v1/ktv-safety/' + sessionId + '/point')
      .send(point())
      .expect(404);
    await api(0)
      .post('/api/v1/ktv-safety/' + sessionId + '/point')
      .send(point())
      .expect(403);
    const fix = await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/point')
      .send(point())
      .expect(201);
    expect(fix.body.point.latitude).toBe(21.01234);
    const [raw] = await db.query<{ value: unknown }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      ['mocmaria.safety.session.' + sessionId],
    );
    const encoded = JSON.stringify(raw.value);
    expect(encoded).not.toContain('21.01234');
    expect(encoded).not.toContain('12 Nguyễn Trãi');
    expect(encoded).not.toContain('QA customer');
    const admin = await api(2).get('/api/v1/ktv-safety/monitor').expect(200);
    expect(admin.headers['cache-control']).toContain('no-store');
    expect(admin.body.sessions[0].point.longitude).toBe(105.81234);
    expect(admin.body.sessions[0].sealedPoint).toBeUndefined();
    expect((await api(3).get('/api/v1/ktv-safety/me')).body).toEqual([]);
  });
  it('rejects stale/future GPS and invalid coordinates; never refreshes old fix on receipt', async () => {
    for (const value of [
      { ...point(), latitude: 91 },
      { ...point(), recordedAt: new Date(Date.now() - 120000).toISOString() },
      { ...point(), recordedAt: new Date(Date.now() + 120000).toISOString() },
    ])
      await api(1)
        .post('/api/v1/ktv-safety/' + sessionId + '/point')
        .send(value)
        .expect(400);
    const old = await api(1).get('/api/v1/ktv-safety/me');
    const p = { ...point(), recordedAt: new Date(Date.now() - 10000).toISOString() };
    await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/point')
      .send(p)
      .expect(201);
    expect((await api(1).get('/api/v1/ktv-safety/me')).body[0].point.recordedAt).toBe(
      old.body[0].point.recordedAt,
    );
  });
  it('pause erases live GPS and SOS still works without GPS; customer cannot send/ack it', async () => {
    await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/action')
      .send({ action: 'PAUSE' })
      .expect(201);
    await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/point')
      .send(point())
      .expect(409);
    const sos = await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/action')
      .send({ action: 'SOS' })
      .expect(201);
    alertId = sos.body.sos.id;
    expect(sos.body.sos.point).toBeNull();
    await api(0)
      .post('/api/v1/ktv-safety/' + sessionId + '/action')
      .send({ action: 'SOS' })
      .expect(403);
    await api(3)
      .post('/api/v1/ktv-safety/' + sessionId + '/action')
      .send({ action: 'SOS' })
      .expect(404);
    await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/incident')
      .send({ alertId, action: 'ACKNOWLEDGE', note: 'đang liên hệ' })
      .expect(403);
    const again = await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/action')
      .send({ action: 'SOS' })
      .expect(201);
    expect(again.body.sos.id).toBe(alertId);
  });
  it('requires acknowledgement before resolution and audits operator access/actions without GPS', async () => {
    const url = '/api/v1/ktv-safety/' + sessionId + '/incident';
    await api(2).post(url).send({ alertId, action: 'RESOLVE', note: 'đã kiểm tra' }).expect(409);
    await api(2)
      .post(url)
      .send({ alertId: randomUUID(), action: 'ACKNOWLEDGE', note: 'đang gọi KTV' })
      .expect(409);
    await api(2)
      .post(url)
      .send({ alertId, action: 'ACKNOWLEDGE', note: 'Đã gọi KTV, đang hỗ trợ' })
      .expect(201);
    expect((await api(1).get('/api/v1/ktv-safety/me')).body[0].sos.status).toBe('ACKNOWLEDGED');
    await api(2)
      .post(url)
      .send({ alertId, action: 'RESOLVE', note: 'Đã liên hệ xác nhận KTV an toàn' })
      .expect(201);
    const logs = await db.query<{ metadata: unknown }[]>(
      `SELECT metadata FROM audit_logs WHERE event LIKE 'ktv.safety.%'`,
    );
    expect(logs.length).toBeGreaterThan(3);
    expect(JSON.stringify(logs)).not.toContain('21.01234');
  });
  it('stop blocks subsequent writes and no longer exposes live point', async () => {
    await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/action')
      .send({ action: 'RESUME' })
      .expect(201);
    await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/point')
      .send(point())
      .expect(201);
    const stopped = await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/action')
      .send({ action: 'STOP' })
      .expect(201);
    expect(stopped.body.point).toBeNull();
    expect(stopped.body.sharing).toBe(false);
    await api(1)
      .post('/api/v1/ktv-safety/' + sessionId + '/point')
      .send(point())
      .expect(409);
  });
  it('expires sessions server-side and limits the encrypted SOS snapshot retention', async () => {
    const r = await api(1).post('/api/v1/ktv-safety').send(start()).expect(201);
    const id = r.body.id as string;
    await api(1)
      .post('/api/v1/ktv-safety/' + id + '/point')
      .send(point())
      .expect(201);
    const sos = await api(1)
      .post('/api/v1/ktv-safety/' + id + '/action')
      .send({ action: 'SOS' })
      .expect(201);
    expect(sos.body.sos.point.latitude).toBe(21.01234);
    const key = 'mocmaria.safety.session.' + id;
    await db.query(
      `UPDATE app_metadata SET value=jsonb_set(value,'{expiresAt}',to_jsonb($2::text)) WHERE key=$1`,
      [key, new Date(Date.now() - 1000).toISOString()],
    );
    await api(1)
      .post('/api/v1/ktv-safety/' + id + '/point')
      .send(point())
      .expect(409);
    await app.get(KtvSafetyService).sweep();
    const monitored = await api(2).get('/api/v1/ktv-safety/monitor').expect(200);
    const ended = monitored.body.sessions.find((s: { id: string }) => s.id === id);
    expect(ended.status).toBe('EXPIRED');
    expect(ended.point).toBeNull();
    expect(ended.sos.point.latitude).toBe(21.01234);
    await db.query(
      `UPDATE app_metadata SET value=jsonb_set(value,'{sos,pointRecordedAt}',to_jsonb($2::text)) WHERE key=$1`,
      [key, new Date(Date.now() - 2 * 86400000).toISOString()],
    );
    await app.get(KtvSafetyService).sweep();
    const [row] = await db.query<{ value: { sos: { sealedPoint?: string } } }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [key],
    );
    expect(row.value.sos.sealedPoint).toBeUndefined();
  });
  it('retention maintenance redacts expired context and deletes old resolved sessions', async () => {
    const key = 'mocmaria.safety.session.' + sessionId;
    await db.query(
      `UPDATE app_metadata SET value=jsonb_set(value,'{endedAt}',to_jsonb($2::text)) WHERE key=$1`,
      [key, new Date(Date.now() - 2 * 86400000).toISOString()],
    );
    await app.get(KtvSafetyService).sweep();
    const [r] = await db.query<{ value: { sealedVisit?: string } }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [key],
    );
    expect(r.value.sealedVisit).toBeUndefined();
    await db.query(
      `UPDATE app_metadata SET value=jsonb_set(value,'{endedAt}',to_jsonb($2::text)) WHERE key=$1`,
      [key, new Date(Date.now() - 8 * 86400000).toISOString()],
    );
    await app.get(KtvSafetyService).sweep();
    expect((await db.query('SELECT key FROM app_metadata WHERE key=$1', [key])).length).toBe(0);
  });
});
