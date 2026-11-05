/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Supertest JSON responses are untyped. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { requireIsolatedDatabase } from './isolated-database';

describe('staff attendance HTTP persistence in isolated PostgreSQL', () => {
  let app: INestApplication, db: DataSource;
  const actors: Array<{ id: string; token: string }> = [];
  const branchId = randomUUID(),
    unconfigured = randomUUID();
  const api = (actor?: number): ReturnType<typeof request.agent> => {
    const agent = request.agent(app.getHttpServer());
    return actor === undefined
      ? agent
      : agent.set('Authorization', 'Bearer ' + actors[actor].token);
  };
  const endpoint = '/api/v1/staff-attendance';
  const accurate = { branchId, latitude: 21, longitude: 105, accuracyMeters: 10 };
  beforeAll(async () => {
    requireIsolatedDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    for (let i = 0; i < 4; i++) {
      const email = `attendance-${randomUUID()}@mocmaria.test`,
        password = randomBytes(24).toString('base64url') + '1!';
      const registered = await api()
        .post('/api/v1/auth/register')
        .send({ email, password, displayName: 'Isolated Attendance ' + i })
        .expect(201);
      const id = registered.body.user.id;
      if (i === 1 || i === 3)
        await db.query(
          "INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='THERAPIST' ON CONFLICT DO NOTHING",
          [id],
        );
      if (i === 2 || i === 3)
        await db.query(
          'INSERT INTO staff_profiles(user_id,public_name,is_active) VALUES($1,$2,$3)',
          [id, 'Isolated Staff', i === 2],
        );
      const login = await api()
        .post('/api/v1/auth/login')
        .send({ identifier: email, password })
        .expect(200);
      actors.push({ id, token: login.body.accessToken });
    }
    await db.query(
      'INSERT INTO branches(id,code,name,address,latitude,longitude) VALUES($1,$2,$3,$4,21,105),($5,$6,$7,$4,NULL,NULL)',
      [
        branchId,
        'qa-' + branchId,
        'Isolated Attendance Branch',
        'Isolated address',
        unconfigured,
        'qa-' + unconfigured,
        'Isolated Unconfigured Branch',
      ],
    );
  });
  beforeEach(async () => {
    const ids = actors.map((a) => a.id);
    await db.query('DELETE FROM staff_coin_ledger WHERE user_id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM staff_check_ins WHERE user_id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM staff_coin_wallets WHERE user_id=ANY($1::uuid[])', [ids]);
  });
  afterAll(async () => {
    await app?.close();
  });
  it('protects personal attendance, customer access and inactive staff', async () => {
    await api()
      .get(endpoint + '/me')
      .expect(401);
    await api(0)
      .get(endpoint + '/me')
      .expect(403);
    await api(0)
      .post(endpoint + '/check-ins')
      .send(accurate)
      .expect(403);
    await api(3)
      .post(endpoint + '/check-ins')
      .send(accurate)
      .expect(403);
    const me = await api(2)
      .get(endpoint + '/me')
      .expect(200);
    expect(me.headers['cache-control']).toBe('private, no-store');
    expect(me.body.wallet).toEqual({ balance: 0, totalEarned: 0 });
    await api(1).get('/api/v1/admin/staff-attendance/check-ins').expect(403);
  });
  it.each([
    { branchId, latitude: 21 },
    { branchId, longitude: 105 },
    { ...accurate, latitude: 91 },
    { ...accurate, accuracyMeters: 101 },
    { ...accurate, accuracyMeters: -1 },
    { branchId, latitude: 21, longitude: 105 },
    { ...accurate, coinsEarned: 500 },
  ])('rejects invalid or imprecise request without using daily attendance: %j', async (body) => {
    await api(1)
      .post(endpoint + '/check-ins')
      .send(body)
      .expect(400);
    const me = await api(1)
      .get(endpoint + '/me')
      .expect(200);
    expect(me.body.today).toBeNull();
    expect(me.body.wallet.balance).toBe(0);
  });
  it('persists one daily attendance, wallet and ledger entry across concurrent requests and retries', async () => {
    const responses = await Promise.all([
      api(1)
        .post(endpoint + '/check-ins')
        .send(accurate),
      api(1)
        .post(endpoint + '/check-ins')
        .send(accurate),
      api(1)
        .post(endpoint + '/check-ins')
        .send(accurate),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(responses.filter((r) => r.body.alreadyCheckedIn === false)).toHaveLength(1);
    const again = await api(1)
      .post(endpoint + '/check-ins')
      .send({ branchId: randomUUID() })
      .expect(201);
    expect(again.body.alreadyCheckedIn).toBe(true);
    const me = await api(1)
      .get(endpoint + '/me')
      .expect(200);
    expect(me.body).toMatchObject({
      today: { status: 'IN_RANGE', coinsEarned: 5 },
      wallet: { balance: 5, totalEarned: 5 },
      policy: { maxCheckInsPerDay: 1, timezone: 'Asia/Ho_Chi_Minh' },
    });
    const [counts] = await db.query(
      'SELECT (SELECT count(*)::int FROM staff_check_ins WHERE user_id=$1) AS attendance,(SELECT count(*)::int FROM staff_coin_ledger WHERE user_id=$1) AS ledger',
      [actors[1].id],
    );
    expect(counts).toEqual({ attendance: 1, ledger: 1 });
    const history = await api(1)
      .get(endpoint + '/me/history')
      .expect(200);
    expect(history.body).toHaveLength(1);
    const other = await api(2)
      .get(endpoint + '/me')
      .expect(200);
    expect(other.body.today).toBeNull();
  });
  it.each([
    [{ branchId }, 'LOCATION_UNAVAILABLE'],
    [{ branchId: unconfigured }, 'LOCATION_NOT_CONFIGURED'],
    [{ ...accurate, latitude: 21.01 }, 'OUT_OF_RANGE'],
  ])(
    'records explicitly requested zero-coin attendance and does not permit a reward upgrade',
    async (body, status) => {
      const response = await api(1)
        .post(endpoint + '/check-ins')
        .send(body)
        .expect(201);
      expect(response.body).toMatchObject({
        today: { status, coinsEarned: 0 },
        wallet: { balance: 0, totalEarned: 0 },
      });
      const retry = await api(1)
        .post(endpoint + '/check-ins')
        .send(accurate)
        .expect(201);
      expect(retry.body).toMatchObject({
        alreadyCheckedIn: true,
        today: { status, coinsEarned: 0 },
        wallet: { balance: 0, totalEarned: 0 },
      });
    },
  );
  it('rejects an inactive or missing branch', async () => {
    await api(1)
      .post(endpoint + '/check-ins')
      .send({ ...accurate, branchId: randomUUID() })
      .expect(404);
  });
});
