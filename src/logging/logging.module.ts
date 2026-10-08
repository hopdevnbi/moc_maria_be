import { LoggerModule } from 'nestjs-pino';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level:
          process.env['NODE_ENV'] === 'test'
            ? 'silent'
            : process.env['NODE_ENV'] === 'production'
              ? 'info'
              : 'debug',
        serializers: {
          req: (request: { id?: string | number; method?: string; url?: string }) => ({
            id: request.id,
            method: request.method,
            url: request.url?.split('?')[0],
          }),
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'password',
            '*.password',
            'token',
            '*.token',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env['NODE_ENV'] === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:standard' },
              },
      },
    }),
  ],
  exports: [LoggerModule],
})
export class ApplicationLoggingModule {}
