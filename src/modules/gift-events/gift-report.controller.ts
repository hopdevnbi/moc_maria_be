import { Controller, Get, Header, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftReportService, giftReportCsv, type GiftReport } from './gift-report.service';

@ApiBearerAuth()
@ApiTags('Admin - Đối soát Event')
@Controller('admin/gift-events/:eventId/report')
@UseGuards(AccessTokenGuard)
export class GiftReportController {
  constructor(private readonly service: GiftReportService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId', ParseUUIDPipe) id: string,
  ): Promise<GiftReport> {
    return this.service.report(actor, id);
  }
  @Get('csv')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async csv(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.service.report(actor, id);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="moc-maria-event-' + id + '.csv"',
    );
    return giftReportCsv(report);
  }
}
