import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns liveness metadata', () => {
    const dataSource = { isInitialized: true, query: jest.fn() } as unknown as DataSource;
    const service = new HealthService(dataSource);

    expect(service.getLiveness()).toEqual({
      status: 'ok',
      service: 'moc-maria-api',
    });
  });

  it('reports readiness when PostgreSQL responds', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ result: 1 }]),
    } as unknown as DataSource;
    const service = new HealthService(dataSource);

    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ok',
      service: 'moc-maria-api',
      checks: { database: 'up' },
    });
  });

  it('fails readiness when PostgreSQL is unavailable', async () => {
    const dataSource = {
      isInitialized: false,
      query: jest.fn(),
    } as unknown as DataSource;
    const service = new HealthService(dataSource);

    await expect(service.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
