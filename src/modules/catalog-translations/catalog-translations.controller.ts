import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthUserContext } from '../identity/identity.types';
import { SaveCatalogTranslationDto } from './catalog-translations.dto';
import { CatalogTranslationsService } from './catalog-translations.service';

@ApiTags('catalog-translations')
@Controller()
export class CatalogTranslationsController {
  constructor(private readonly service: CatalogTranslationsService) {}

  @Get('catalog-translations/:kind/:id/:locale')
  @Header('Cache-Control', 'no-store')
  publicDetail(
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('locale') locale: string,
  ): ReturnType<CatalogTranslationsService['publicDetail']> {
    return this.service.publicDetail(kind, id, locale);
  }

  @Get('admin/catalog-translations/:kind/:id/:locale')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  adminDetail(
    @CurrentUser() actor: AuthUserContext,
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('locale') locale: string,
  ): ReturnType<CatalogTranslationsService['adminDetail']> {
    return this.service.adminDetail(actor, kind, id, locale);
  }

  @Put('admin/catalog-translations/:kind/:id/:locale')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  save(
    @CurrentUser() actor: AuthUserContext,
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('locale') locale: string,
    @Body() dto: SaveCatalogTranslationDto,
  ): ReturnType<CatalogTranslationsService['save']> {
    return this.service.save(actor, kind, id, locale, dto);
  }
}
