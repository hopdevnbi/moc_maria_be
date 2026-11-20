import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { ReferralsService } from './referrals.service';
import { ReferralVerificationService } from './referral-verification.service';
import { IsBoolean, IsInt, IsString, Matches, Min, Max } from 'class-validator';
class ReferralSettingsDto {
  @IsBoolean()
  enabled!: boolean;
  @IsInt()
  @Min(1)
  @Max(100000)
  rewardCoins!: number;
  @IsBoolean()
  payoutEnabled!: boolean;
}
class ConfirmReferralDto {
  @IsString()
  @Matches(/^\d{4,10}$/)
  code!: string;
}

@ApiTags('referrals')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(
    private readonly service: ReferralsService,
    private readonly verification: ReferralVerificationService,
  ) {}
  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() actor: AuthUserContext): ReturnType<ReferralsService['mine']> {
    return this.service.mine(actor);
  }
  @Post('verify/start')
  start(@CurrentUser() actor: AuthUserContext): ReturnType<ReferralVerificationService['start']> {
    return this.verification.start(actor);
  }
  @Post('verify/confirm')
  confirm(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ConfirmReferralDto,
  ): ReturnType<ReferralVerificationService['confirm']> {
    return this.verification.confirm(actor, dto.code);
  }
  @Get('admin/settings')
  @Header('Cache-Control', 'private, no-store')
  settings(@CurrentUser() actor: AuthUserContext): ReturnType<ReferralsService['settings']> {
    return this.service.settings(actor);
  }
  @Put('admin/settings')
  saveSettings(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ReferralSettingsDto,
  ): ReturnType<ReferralsService['saveSettings']> {
    return this.service.saveSettings(actor, dto);
  }
  @Get('admin')
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() actor: AuthUserContext,
    @Query('page') page = '1',
  ): ReturnType<ReferralsService['list']> {
    if (typeof page !== 'string' || !/^[1-9][0-9]{0,3}$/.test(page))
      throw new BadRequestException('REFERRAL_PAGE_INVALID');
    return this.service.list(actor, Number(page));
  }
  @Post('admin/:id/review')
  @Header('Cache-Control', 'private, no-store')
  review(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ReferralsService['review']> {
    return this.service.review(actor, id);
  }
}
