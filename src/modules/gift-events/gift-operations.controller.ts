import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthUserContext } from '../identity/identity.types';
import {
  GiftOperationsService,
  giftOpsCsv,
  type GiftOperationsReport,
} from './gift-operations.service';
import {
  GiftOperationsFilterDto,
  GiftRetryNoticeDto,
  GiftNoticeChannelDto,
} from './gift-operations.dto';

@ApiBearerAuth()
@ApiTags('Admin - Vận hành Event')
@Controller('admin/gift-event-operations')
@UseGuards(AccessTokenGuard)
export class GiftOperationsController {
  constructor(private readonly service: GiftOperationsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(
    @CurrentUser() actor: AuthUserContext,
    @Query() filter: GiftOperationsFilterDto,
  ): Promise<GiftOperationsReport> {
    return this.service.report(actor, filter);
  }
  @Get('csv')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async csv(
    @CurrentUser() actor: AuthUserContext,
    @Query() filter: GiftOperationsFilterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const report = await this.service.report(actor, filter);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="moc-maria-voucher-operations.csv"');
    return giftOpsCsv(report);
  }
  @Get('notifications/failed')
  @Header('Cache-Control', 'private, no-store')
  failedNotices(
    @CurrentUser() actor: AuthUserContext,
    @Query() filter: GiftOperationsFilterDto,
  ): ReturnType<GiftOperationsService['failedNotices']> {
    return this.service.failedNotices(actor, filter);
  }
  @Post('notifications/:rewardId/:channel/retry')
  @Header('Cache-Control', 'private, no-store')
  retry(
    @CurrentUser() actor: AuthUserContext,
    @Param('rewardId', new ParseUUIDPipe({ version: '4' })) rewardId: string,
    @Param() route: GiftNoticeChannelDto,
    @Body() dto: GiftRetryNoticeDto,
  ): Promise<{ retried: true }> {
    return this.service.retry(actor, rewardId, route.channel, dto.reason);
  }
}
