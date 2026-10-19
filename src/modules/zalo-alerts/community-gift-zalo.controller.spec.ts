import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  CommunityGiftZaloAuthGuard,
  CommunityGiftZaloController,
} from './community-gift-zalo.controller';
import { ZaloAlertsService } from './zalo-alerts.service';

describe('Community gift Zalo webhook authentication', () => {
  let app: INestApplication;
  const secret = 'integration-test-only-webhook-secret-value';
  const query = jest.fn().mockResolvedValue([{ secret }]);
  const alerts = {
    configuredRecipients: jest.fn().mockResolvedValue([]),
    enqueueText: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CommunityGiftZaloController],
      providers: [
        CommunityGiftZaloAuthGuard,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: DataSource, useValue: { query, transaction: jest.fn() } },
        { provide: ZaloAlertsService, useValue: alerts },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns HTTP 401 on anonymous empty POST before DTO validation or database reads', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/zalo/community-gift')
      .send({})
      .expect(401);
    expect(query).not.toHaveBeenCalled();
    expect(alerts.enqueueText).not.toHaveBeenCalled();
  });

  it('rejects an invalid secret without attempting to enqueue messages', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/zalo/community-gift')
      .set('x-community-gift-secret', 'invalid')
      .send({})
      .expect(401);
    expect(query).not.toHaveBeenCalled();
    expect(alerts.enqueueText).not.toHaveBeenCalled();
  });

  it('validates the notification body only after successful authentication', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/zalo/community-gift')
      .set('x-community-gift-secret', secret)
      .send({})
      .expect(400);
    expect(query).toHaveBeenCalledTimes(1);
    expect(alerts.enqueueText).not.toHaveBeenCalled();
  });
});
