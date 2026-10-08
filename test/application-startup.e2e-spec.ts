import 'dotenv/config';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';

// Read-only integration checks: exercise the complete module graph, not just AuthModule.
describe('Application startup and public API integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('starts all modules and verifies database readiness', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/health/live')
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/health/ready')
      .expect(200);
  });

  it('blocks untrusted origins before cookie-auth mutations', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'moc_maria_refresh=untrusted-fixture')
      .expect(403);
  });

  it('allows only configured origins on credentialed CORS responses', async () => {
    const allowed = (process.env['CORS_ORIGINS'] || 'http://localhost:3001').split(',')[0];
    await request(app.getHttpServer() as Server)
      .options('/api/v1/auth/login')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'POST')
      .expect('Access-Control-Allow-Origin', allowed)
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect(204);
    const response = await request(app.getHttpServer() as Server)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['services', 'service-categories', 'providers', 'branches'])(
    'serves the public %s endpoint',
    async (path) => {
      const response = await request(app.getHttpServer() as Server)
        .get('/api/v1/' + path)
        .expect(200);
      expect(Array.isArray(response.body)).toBe(true);
    },
  );

  it.each(['branches', 'services', 'provider-applications', 'provider-training/courses'])(
    'protects the admin %s endpoint',
    async (path) => {
      await request(app.getHttpServer() as Server)
        .get('/api/v1/admin/' + path)
        .expect(401);
    },
  );
});
