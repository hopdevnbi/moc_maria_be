import { Module } from '@nestjs/common';
import { ApplicationConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { GlobalExceptionFilter } from './http/global-exception.filter';
import { ApplicationLoggingModule } from './logging/logging.module';

@Module({
  imports: [ApplicationConfigModule, ApplicationLoggingModule, DatabaseModule, HealthModule],
  providers: [GlobalExceptionFilter],
})
export class AppModule {}
