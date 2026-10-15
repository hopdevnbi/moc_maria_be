import { Body, Controller, Get, Header, Post, HttpCode, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftRedeemService } from './gift-redeem.service';
import { GiftCounterGrantDto, RedeemGiftDto, VerifyGiftDto } from './gift-redeem.dto';
import { GiftAbuseService } from './gift-abuse.service';

@ApiBearerAuth()
@ApiTags('Event - Quầy xác minh nhận quà')
@Controller('staff/gift-redemptions')
@UseGuards(AccessTokenGuard)
export class GiftRedeemController {
  constructor(
    private readonly service: GiftRedeemService,
    private readonly abuse: GiftAbuseService,
  ) {}
  @Get('branches')
  @Header('Cache-Control', 'private, no-store')
  branches(@CurrentUser() actor: AuthUserContext): ReturnType<GiftRedeemService['branches']> {
    return this.service.branches(actor);
  }
  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async verify(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: VerifyGiftDto,
  ): ReturnType<GiftRedeemService['verify']> {
    await this.abuse.consume(actor, 'VERIFY', dto.branchId);
    return this.service.verify(actor, dto);
  }
  @Post('redeem')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async redeem(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: RedeemGiftDto,
  ): ReturnType<GiftRedeemService['redeem']> {
    await this.abuse.consume(actor, 'REDEEM', dto.branchId);
    return this.service.redeem(actor, dto);
  }
}

@ApiBearerAuth()
@ApiTags('Admin - Quyền đổi quà tại quầy')
@Controller('admin/gift-events/counter-access')
@UseGuards(AccessTokenGuard)
export class GiftCounterAccessController {
  constructor(private readonly service: GiftRedeemService) {}
  @Post('grant')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  grant(@CurrentUser() actor: AuthUserContext, @Body() dto: GiftCounterGrantDto): Promise<void> {
    return this.service.grant(actor, dto);
  }
  @Post('revoke')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  revoke(@CurrentUser() actor: AuthUserContext, @Body() dto: GiftCounterGrantDto): Promise<void> {
    return this.service.revoke(actor, dto);
  }
}
