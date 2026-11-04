import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import { ZaloBotService } from './zalo-bot.service';
import { ZaloBotSettingsService } from './zalo-bot-settings.service';

@Controller('zalo')
export class ZaloWebhookController {
  constructor(private readonly bot: ZaloBotService) {}
  @Post('webhook')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  receive(
    @Headers('x-bot-api-secret-token') secret: string | undefined,
    @Body() update: Parameters<ZaloBotService['receive']>[1],
  ): ReturnType<ZaloBotService['receive']> {
    return this.bot.receive(secret, update);
  }
}

@Controller('admin/zalo-bot')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ROLE_MANAGE)
export class ZaloBotAdminController {
  constructor(private readonly bot: ZaloBotService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(): ReturnType<ZaloBotService['status']> {
    return this.bot.status();
  }
  @Post('pairing')
  @Header('Cache-Control', 'private, no-store')
  pairing(): ReturnType<ZaloBotService['createPairing']> {
    return this.bot.createPairing();
  }
  @Post('test')
  test(): ReturnType<ZaloBotService['test']> {
    return this.bot.test();
  }
}

@Controller('admin/zalo-bots')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ROLE_MANAGE)
export class ZaloBotsAdminController {
  constructor(private readonly settings: ZaloBotSettingsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(): ReturnType<ZaloBotSettingsService['list']> {
    return this.settings.list();
  }

  @Patch(':id/settings')
  @Header('Cache-Control', 'private, no-store')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
  ): ReturnType<ZaloBotSettingsService['update']> {
    return this.settings.update(id, body);
  }
}
