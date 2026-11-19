import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogTranslationsController } from './catalog-translations.controller';
import { CatalogTranslationsService } from './catalog-translations.service';
import { ProviderDisplayModule } from '../provider-display/provider-display.module';
import { ProviderShowcaseTranslationsController } from './provider-showcase-translations.controller';
import { ProviderShowcaseTranslationsService } from './provider-showcase-translations.service';

@Module({
  imports: [AuthModule, ProviderDisplayModule],
  controllers: [CatalogTranslationsController, ProviderShowcaseTranslationsController],
  providers: [CatalogTranslationsService, ProviderShowcaseTranslationsService],
})
export class CatalogTranslationsModule {}
