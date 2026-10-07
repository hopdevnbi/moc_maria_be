import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from './health.service';
import type { LivenessResponse, ReadinessResponse } from './health.types';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get(['', 'live'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process liveness check' })
  @ApiOkResponse({ description: 'Application process is running.' })
  getLiveness(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Database readiness check' })
  @ApiOkResponse({ description: 'Application can reach PostgreSQL.' })
  @ApiServiceUnavailableResponse({ description: 'PostgreSQL is unavailable.' })
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }
}
