import { Body, Controller, Get, Header, Post, HttpCode, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftRedeemService } from './gift-redeem.service';
import {
  GiftCounterGrantDto,
  RedeemGiftDto,
  VerifyGiftDto,
  RedeemGiftCodeDto,
  VerifyGiftCodeDto,
  GiftVoucherQuoteDto,
  GiftVoucherQrQuoteDto,
} from './gift-redeem.dto';
import { GiftAbuseService, GIFT_ALL_BRANCHES_SCOPE } from './gift-abuse.service';

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
    // Per-actor global ceiling prevents bypass by rotating among branches.
    await this.abuse.consume(actor, 'VERIFY', GIFT_ALL_BRANCHES_SCOPE);
    await this.abuse.consume(actor, 'VERIFY', dto.branchId);
    return this.service.verify(actor, dto);
  }
  @Post('verify-code')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async verifyCode(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: VerifyGiftCodeDto,
  ): ReturnType<GiftRedeemService['verifyCode']> {
    await this.abuse.consume(actor, 'VERIFY', GIFT_ALL_BRANCHES_SCOPE);
    await this.abuse.consume(actor, 'VERIFY', dto.branchId);
    return this.service.verifyCode(actor, dto);
  }
  @Post('quote-code')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async quoteCode(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: GiftVoucherQuoteDto,
  ): ReturnType<GiftRedeemService['quoteCode']> {
    await this.abuse.consume(actor, 'VERIFY', GIFT_ALL_BRANCHES_SCOPE);
    await this.abuse.consume(actor, 'VERIFY', dto.branchId);
    return this.service.quoteCode(actor, dto);
  }
  @Post('quote-qr')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async quoteQr(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: GiftVoucherQrQuoteDto,
  ): ReturnType<GiftRedeemService['quoteQr']> {
    await this.abuse.consume(actor, 'VERIFY', GIFT_ALL_BRANCHES_SCOPE);
    await this.abuse.consume(actor, 'VERIFY', dto.branchId);
    return this.service.quoteQr(actor, dto);
  }
  @Post('redeem')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async redeem(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: RedeemGiftDto,
  ): ReturnType<GiftRedeemService['redeem']> {
    await this.abuse.consume(actor, 'REDEEM', GIFT_ALL_BRANCHES_SCOPE);
    await this.abuse.consume(actor, 'REDEEM', dto.branchId);
    return this.service.redeem(actor, dto);
  }
  @Post('redeem-code')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async redeemCode(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: RedeemGiftCodeDto,
  ): ReturnType<GiftRedeemService['redeemCode']> {
    await this.abuse.consume(actor, 'REDEEM', GIFT_ALL_BRANCHES_SCOPE);
    await this.abuse.consume(actor, 'REDEEM', dto.branchId);
    return this.service.redeemCode(actor, dto);
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
