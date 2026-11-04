import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { CreateTipIntentDto, TipOwnershipDto, UpdateTipSettingsDto } from './provider-tips.dto';
import { ProviderTipsService, type TipSettings } from './provider-tips.service';

type ImageFile = { buffer: Buffer; mimetype: string; size: number };

@ApiTags('provider-tips')
@Controller('provider-tips')
export class ProviderTipsController {
  constructor(private readonly tips: ProviderTipsService) {}

  @Get(':id/config')
  @Header('Cache-Control', 'public, no-store')
  config(@Param('id', new ParseUUIDPipe()) id: string): Promise<TipSettings> {
    return this.tips.publicSettings(id);
  }

  @Get(':id/config/editor')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  editor(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TipSettings> {
    return this.tips.editorSettings(actor, id);
  }

  @Patch(':id/config')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  update(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTipSettingsDto,
  ): Promise<TipSettings> {
    return this.tips.saveSettings(actor, id, dto);
  }

  @Post(':id/qr')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(AccessTokenGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  uploadQr(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file?: ImageFile,
  ): Promise<{ qrUrl: string }> {
    return this.tips.uploadQr(actor, id, file);
  }

  @Post(':id/intents')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  create(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateTipIntentDto,
  ): ReturnType<ProviderTipsService['createIntent']> {
    return this.tips.createIntent(id, dto);
  }

  @Post(':id/intents/:tipId/declare')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  declare(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('tipId', new ParseUUIDPipe()) tipId: string,
    @Body() dto: TipOwnershipDto,
  ): ReturnType<ProviderTipsService['selfReport']> {
    return this.tips.selfReport(id, tipId, dto.token);
  }

  @Post(':id/intents/:tipId/keepsake')
  @ApiConsumes('multipart/form-data')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  keepsake(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('tipId', new ParseUUIDPipe()) tipId: string,
    @Body('token') token: string,
    @Body('consentVersion') consent: string,
    @UploadedFile() file?: ImageFile,
  ): Promise<{ saved: true }> {
    return this.tips.uploadKeepsake(id, tipId, token, consent, file);
  }

  @Get(':id/intents/:tipId/keepsake')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Type', 'image/png')
  async viewKeepsake(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('tipId', new ParseUUIDPipe()) tipId: string,
  ): Promise<StreamableFile> {
    return new StreamableFile(await this.tips.privateKeepsake(actor, id, tipId));
  }

  @Get(':id/report')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  report(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ProviderTipsService['report']> {
    return this.tips.report(actor, id);
  }
}
