import { Injectable, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface DatabaseConfiguration {
  url?: string;
  migrationUrl?: string;
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  ssl: boolean;
  rejectUnauthorized: boolean;
  poolMax: number;
}

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  getNodeEnv(): NodeEnvironment {
    return this.config.getOrThrow<NodeEnvironment>('NODE_ENV');
  }

  getPort(): number {
    return this.config.getOrThrow<number>('PORT');
  }

  getCorsAllowedOrigins(): string[] {
    return this.config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  isSwaggerEnabled(): boolean {
    return this.config.getOrThrow<boolean>('SWAGGER_ENABLED');
  }

  getDatabaseConfiguration(): DatabaseConfiguration {
    const url = this.config.get<string>('DATABASE_URL')?.trim() || undefined;
    const migrationUrl = this.config.get<string>('DATABASE_MIGRATION_URL')?.trim() || undefined;
    return {
      url,
      migrationUrl,
      host: this.config.getOrThrow<string>('DATABASE_HOST'),
      port: this.config.getOrThrow<number>('DATABASE_PORT'),
      name: this.config.getOrThrow<string>('DATABASE_NAME'),
      user: this.config.getOrThrow<string>('DATABASE_USER'),
      password: this.config.getOrThrow<string>('DATABASE_PASSWORD'),
      ssl: this.config.getOrThrow<boolean>('DATABASE_SSL'),
      rejectUnauthorized: this.config.getOrThrow<boolean>('DATABASE_SSL_REJECT_UNAUTHORIZED'),
      poolMax: this.config.getOrThrow<number>('DATABASE_POOL_MAX'),
    };
  }

  createValidationPipe(): ValidationPipe {
    return new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    });
  }
}
