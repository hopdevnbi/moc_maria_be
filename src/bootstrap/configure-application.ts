import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
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
  application.use(cookieParser());
  application.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.headers.authorization ||
      /^\/api\/v1\/(auth|admin|customers|staff|provider-applications)(\/|$)/.test(request.path)
    ) {
      response.setHeader('Cache-Control', 'private, no-store');
    }
    next();
  });
  application.use((request: Request, response: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const origin = request.headers.origin;
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const cookieSessionRequest =
      request.path.startsWith('/api/v1/auth/') && Boolean(cookies?.['moc_maria_refresh']);
    if (
      (origin !== undefined && !config.getCorsAllowedOrigins().includes(origin)) ||
      (cookieSessionRequest && origin === undefined)
    ) {
      response.status(403).json({ message: 'Request origin is not allowed.' });
      return;
    }
    next();
  });
  application.use((request: Request, response: Response, next: NextFunction) => {
    const incoming = request.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(incoming)
        ? incoming
        : randomUUID();
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
        .setVersion('0.2.0')
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
