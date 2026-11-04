import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { publicCacheTtl } from './public-cache-policy';
import { PublicCacheGenerationChanged, PublicMemoryCache } from './public-memory-cache';
import { PublicRevisionService } from './public-revision.service';

class UnverifiedPublicRead extends Error {
  constructor(readonly value: unknown) {
    super('Public revision check failed');
  }
}

@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly revisions: PublicRevisionService,
    private readonly cache: PublicMemoryCache,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    if (context.getType() !== 'http' || !this.revisions.enabled) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const path = request.path.replace(/^\/api\/v1(?=\/)/, '').replace(/\/$/, '') || '/';
    const ttl = publicCacheTtl(path);
    if (
      request.method !== 'GET' ||
      ttl === null ||
      request.headers.authorization ||
      request.headers.cookie ||
      Object.keys(request.query).length
    ) {
      return next.handle();
    }
    response.setHeader('Cache-Control', 'no-store');
    return defer(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let snapshot;
        try {
          snapshot = await this.revisions.read();
        } catch {
          response.setHeader('X-Public-Cache', 'BYPASS');
          return lastValueFrom(next.handle());
        }
        this.cache.observe(snapshot.revision);
        try {
          const result = await this.cache.getOrLoad(path, snapshot.revision, ttl, async () => {
            const data: unknown = await lastValueFrom(next.handle());
            const after = await this.revisions.read().catch(() => {
              throw new UnverifiedPublicRead(data);
            });
            if (after.revision !== snapshot.revision) throw new PublicCacheGenerationChanged();
            return data;
          });
          response.setHeader('X-Public-Cache', result.state);
          response.setHeader('X-Public-Revision', snapshot.revision);
          response.setHeader('X-Public-Cache-Bytes', this.cache.stats().bytes);
          return result.value;
        } catch (error) {
          if (error instanceof UnverifiedPublicRead) {
            response.setHeader('X-Public-Cache', 'BYPASS');
            return error.value;
          }
          if (!(error instanceof PublicCacheGenerationChanged)) throw error;
        }
      }
      response.setHeader('X-Public-Cache', 'BYPASS');
      return lastValueFrom(next.handle());
    });
  }
}
