import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { API_GLOBAL_PREFIX, APP_ID } from '../app.constants';
import { AppConfigService } from '../config/app-config.service';
import { GlobalExceptionFilter } from '../http/global-exception.filter';

export function configureApplication(application: INestApplication): void {
  const config = application.get(AppConfigService);

  application.setGlobalPrefix(API_GLOBAL_PREFIX);
  application.enableShutdownHooks();
  application.enableCors({
    origin: config.getCorsAllowedOrigins(),
    credentials: true,
  });
  application.use((request: Request, response: Response, next: NextFunction) => {
    const incoming = request.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  });
  application.useGlobalPipes(config.createValidationPipe());
  application.useGlobalFilters(application.get(GlobalExceptionFilter));

  if (config.isSwaggerEnabled()) {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder()
        .setTitle('Moc Maria API')
        .setDescription('Moc Maria Wellness Platform API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(API_GLOBAL_PREFIX + '/docs', application, document, {
      jsonDocumentUrl: API_GLOBAL_PREFIX + '/docs-json',
    });
  }

  const rawApp = application.getHttpAdapter().getInstance() as { disable?: (name: string) => void };
  rawApp.disable?.('x-powered-by');
  responseSecurityHeaders(application);
}

function responseSecurityHeaders(application: INestApplication): void {
  application.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    response.setHeader('x-moc-maria-service', APP_ID);
    next();
  });
}
