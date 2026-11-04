import { Controller, Get, Header, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PublicMemoryCache } from './public-memory-cache';
import { PublicRevisionService, type PublicRevision } from './public-revision.service';
import { PublicCacheInterceptor } from './public-cache.interceptor';

@Controller('public-content')
class PublicRevisionController {
  constructor(private readonly revisions: PublicRevisionService) {}
  @Get('revision')
  @Header('Cache-Control', 'no-store, max-age=0')
  async revision(): Promise<PublicRevision> {
    try {
      return await this.revisions.read();
    } catch {
      throw new ServiceUnavailableException('Public content revision is temporarily unavailable.');
    }
  }
}

@Module({
  controllers: [PublicRevisionController],
  providers: [
    PublicRevisionService,
    { provide: PublicMemoryCache, useFactory: () => new PublicMemoryCache() },
    { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
  ],
})
export class PublicCacheModule {}
