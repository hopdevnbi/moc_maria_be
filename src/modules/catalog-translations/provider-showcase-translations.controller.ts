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
import { SaveShowcaseTranslationDto } from './provider-showcase-translations.dto';
import { ProviderShowcaseTranslationsService } from './provider-showcase-translations.service';
@ApiTags('provider-showcase-translations')
@Controller()
export class ProviderShowcaseTranslationsController {
  constructor(private readonly service: ProviderShowcaseTranslationsService) {}
  @Get('provider-showcase-translations/:id/:locale')
  @Header('Cache-Control', 'no-store')
  publicDetail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('locale') locale: string,
  ): ReturnType<ProviderShowcaseTranslationsService['publicDetail']> {
    return this.service.publicDetail(id, locale);
  }
  @Get('admin/provider-showcase-translations/:id/:locale')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  adminDetail(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('locale') locale: string,
  ): ReturnType<ProviderShowcaseTranslationsService['adminDetail']> {
    return this.service.adminDetail(actor, id, locale);
  }
  @Put('admin/provider-showcase-translations/:id/:locale')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  save(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('locale') locale: string,
    @Body() dto: SaveShowcaseTranslationDto,
  ): ReturnType<ProviderShowcaseTranslationsService['save']> {
    return this.service.save(actor, id, locale, dto);
  }
}
