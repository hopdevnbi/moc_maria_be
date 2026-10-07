import { LoggerModule } from 'nestjs-pino';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
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
