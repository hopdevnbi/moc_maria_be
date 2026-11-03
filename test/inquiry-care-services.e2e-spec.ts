/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Supertest fixtures. */
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { KtvChatService } from '../src/modules/ktv-chat/ktv-chat.service';
import { AdminAlertsService } from '../src/modules/admin-alerts/admin-alerts.service';
import { INQUIRY_CARE_SLUGS } from '../src/modules/customer-experience/inquiry-care-services';
import { requireIsolatedDatabase } from './isolated-database';

describe('Published care menu requests to all seven KTV in isolated PostgreSQL', () => {
  let app: INestApplication, db: DataSource, token: string, customerId: string, categoryId: string;
  const providers: Array<{
    id: string;
    publicName: string;
    title: string;
    serviceArea: string;
    avatarUrl: null;
    services: Array<{ id: string; name: string }>;
  }> = [];
  const serviceIds: string[] = [];
  const api = (): ReturnType<typeof request.agent> =>
    request.agent(app.getHttpServer()).set('Authorization', 'Bearer ' + token);
  const body = (provider = providers[0].id, service = serviceIds[0]): Record<string, unknown> => ({
    idempotencyKey: randomUUID(),
    providerId: provider,
    serviceId: service,
    location: 'AT_BRANCH',
    address: 'Isolated care branch address',
    requestedAt: new Date(Date.now() + 86400000).toISOString(),
  });
  beforeAll(async () => {
    requireIsolatedDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DataSource);
    const email = `care-${randomUUID()}@mocmaria.test`,
      password = randomBytes(24).toString('base64url') + '1!';
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'Isolated care customer' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password })
      .expect(200);
    token = login.body.accessToken;
    customerId = login.body.user.id;
    for (let index = 0; index < 7; index++) {
      const [user] = await db.query<{ id: string }[]>(
        "INSERT INTO users(email,display_name,password_hash,is_active) VALUES($1,$2,'isolated-provider-no-login',true) RETURNING id",
        [`care-provider-${randomUUID()}@mocmaria.test`, 'Isolated KTV ' + index],
      );
      const [provider] = await db.query<{ id: string }[]>(
        "INSERT INTO provider_applications(user_id,public_name,status) VALUES($1,$2,'APPLIED') RETURNING id",
        [user.id, 'Isolated KTV ' + index],
      );
      providers.push({
        id: provider.id,
        publicName: 'Isolated KTV ' + index,
        title: 'KTV',
        serviceArea: 'Hà Nội',
        avatarUrl: null,
        services: [{ id: 'legacy-care', name: 'Legacy service' }],
      });
    }
    jest.spyOn(app.get(KtvChatService), 'directory').mockResolvedValue(providers);
    jest.spyOn(app.get(AdminAlertsService), 'bookingRequested').mockResolvedValue(undefined);
    const [category] = await db.query<{ id: string }[]>(
      'INSERT INTO service_categories(name,slug,is_published) VALUES($1,$2,true) RETURNING id',
      ['Isolated care menu', randomUUID()],
    );
    categoryId = category.id;
    for (const slug of INQUIRY_CARE_SLUGS) {
      const [service] = await db.query<{ id: string }[]>(
        'INSERT INTO services(category_id,name,slug,is_published) VALUES($1,$2,$3,true) RETURNING id',
        [categoryId, 'Official ' + slug, slug],
      );
      serviceIds.push(service.id);
      await db.query(
        "INSERT INTO service_variants(service_id,name,duration_minutes,price_vnd,is_active) VALUES($1,'60 minutes',60,249000,true)",
        [service.id],
      );
    }
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  it('accepts the exact published catalog ID for each of seven directory KTV and preserves idempotency', async () => {
    for (const provider of providers) {
      const payload = body(provider.id);
      const created = await api().post('/api/v1/appointment-inquiries').send(payload).expect(201);
      expect(created.body).toMatchObject({
        providerId: provider.id,
        serviceId: serviceIds[0],
        serviceName: 'Official ' + INQUIRY_CARE_SLUGS[0],
        status: 'PENDING',
      });
      const retry = await api().post('/api/v1/appointment-inquiries').send(payload).expect(201);
      expect(retry.body.id).toBe(created.body.id);
    }
    const records = await api().get('/api/v1/appointment-inquiries').expect(200);
    expect(
      records.body.filter((row: { serviceId: string }) => row.serviceId === serviceIds[0]),
    ).toHaveLength(7);
    const appointments = await db.query('SELECT id FROM appointments WHERE customer_user_id=$1', [
      customerId,
    ]);
    expect(appointments).toHaveLength(0);
  });

  it('accepts all ten care menu services without requiring legacy assignments', async () => {
    for (const service of serviceIds)
      await api()
        .post('/api/v1/appointment-inquiries')
        .send(body(providers[0].id, service))
        .expect(201);
  });

  it('rejects unknown providers, malformed/unpublished services, hidden categories, inactive variants and drinks', async () => {
    await api().post('/api/v1/appointment-inquiries').send(body(randomUUID())).expect(400);
    for (const id of [randomUUID(), '-'.repeat(36), 'forged'])
      await api().post('/api/v1/appointment-inquiries').send(body(providers[0].id, id)).expect(400);
    await db.query('UPDATE services SET is_published=false WHERE id=$1', [serviceIds[0]]);
    await api().post('/api/v1/appointment-inquiries').send(body()).expect(400);
    await db.query('UPDATE services SET is_published=true WHERE id=$1', [serviceIds[0]]);
    await db.query('UPDATE service_categories SET is_published=false WHERE id=$1', [categoryId]);
    await api().post('/api/v1/appointment-inquiries').send(body()).expect(400);
    await db.query('UPDATE service_categories SET is_published=true WHERE id=$1', [categoryId]);
    await db.query('UPDATE service_variants SET is_active=false WHERE service_id=$1', [
      serviceIds[0],
    ]);
    await api().post('/api/v1/appointment-inquiries').send(body()).expect(400);
    const [drink] = await db.query<{ id: string }[]>(
      "INSERT INTO services(category_id,name,slug,is_published) VALUES($1,'Tea','tra-thao-moc',true) RETURNING id",
      [categoryId],
    );
    await db.query(
      "INSERT INTO service_variants(service_id,name,duration_minutes,price_vnd,is_active) VALUES($1,'Tea',5,69000,true)",
      [drink.id],
    );
    await api()
      .post('/api/v1/appointment-inquiries')
      .send(body(providers[0].id, drink.id))
      .expect(400);
  });
});
