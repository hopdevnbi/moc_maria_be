import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogTranslationsController } from './catalog-translations.controller';
import { CatalogTranslationsService } from './catalog-translations.service';

@Module({
  imports: [AuthModule],
  controllers: [CatalogTranslationsController],
  providers: [CatalogTranslationsService],
})
export class CatalogTranslationsModule {}
