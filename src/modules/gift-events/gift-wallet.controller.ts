import { Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftWalletService, type EventMeView, type WalletReward } from './gift-wallet.service';
import type { GiftOpenResult } from './gift-open.dto';

@ApiBearerAuth()
@ApiTags('Event - Ví quà cá nhân')
@Controller('gift-events')
@UseGuards(AccessTokenGuard)
export class GiftWalletController {
  constructor(private readonly service: GiftWalletService) {}
  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser() actor: AuthUserContext): Promise<EventMeView> {
    return this.service.me(actor);
  }
  @Get('me/rewards')
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthUserContext): Promise<WalletReward[]> {
    return this.service.list(actor);
  }
  @Get('me/rewards/:id')
  @Header('Cache-Control', 'private, no-store')
  detail(@CurrentUser() actor: AuthUserContext, @Param('id') id: string): Promise<WalletReward> {
    return this.service.detail(actor, id);
  }
  @Get('opens/:id')
  @Header('Cache-Control', 'private, no-store')
  result(@CurrentUser() actor: AuthUserContext, @Param('id') id: string): Promise<GiftOpenResult> {
    return this.service.openResult(actor, id);
  }
  @Post('me/rewards/:id/qr')
  @Header('Cache-Control', 'private, no-store')
  qr(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
  ): ReturnType<GiftWalletService['issueQr']> {
    return this.service.issueQr(actor, id);
  }
}
