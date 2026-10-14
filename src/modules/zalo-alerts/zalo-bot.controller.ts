import { Body, Controller, Get, Header, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import { ZaloBotService } from './zalo-bot.service';

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
