import { Body, Controller, Delete, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatPushService } from './ktv-chat-push.service';
import { KtvPushSubscriptionDto, KtvPushUnsubscribeDto } from './ktv-chat-push.dto';

@ApiTags('ktv-chat')
@ApiBearerAuth()
@Controller('ktv-chat/push')
@UseGuards(AccessTokenGuard)
export class KtvChatPushController {
  constructor(private readonly push: KtvChatPushService) {}

  @Get('config')
  @Header('Cache-Control', 'private, no-store')
  config(@CurrentUser() actor: AuthUserContext): { publicKey: string | null } {
    return this.push.config(actor);
  }

  @Post('subscriptions')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  subscribe(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: KtvPushSubscriptionDto,
  ): Promise<void> {
    return this.push.subscribe(actor, dto);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  unsubscribe(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: KtvPushUnsubscribeDto,
  ): Promise<void> {
    return this.push.unsubscribe(actor, dto.endpoint);
  }
}
