import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { LivenessResponse, ReadinessResponse } from './health.types';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'moc-maria-api',
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    try {
      if (!this.dataSource.isInitialized) {
        throw new Error('Data source is not initialized');
      }
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ok',
        service: 'moc-maria-api',
        checks: { database: 'up' },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'moc-maria-api',
        checks: { database: 'down' },
      });
    }
  }
}
