import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftVouchersAdminService } from './gift-vouchers-admin.service';
import { GiftVoucherFilterDto, VoidGiftVoucherDto } from './gift-vouchers-admin.dto';

@ApiBearerAuth()
@ApiTags('Admin - Voucher Event')
@Controller('admin/gift-events/:eventId/vouchers')
@UseGuards(AccessTokenGuard)
export class GiftVouchersAdminController {
  constructor(private readonly service: GiftVouchersAdminService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() filter: GiftVoucherFilterDto,
  ): Promise<unknown[]> {
    return this.service.list(actor, eventId, filter);
  }
  @Patch(':rewardId/void')
  @Header('Cache-Control', 'private, no-store')
  void(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('rewardId', ParseUUIDPipe) rewardId: string,
    @Body() dto: VoidGiftVoucherDto,
  ): Promise<{ status: 'VOIDED'; id: string }> {
    return this.service.void(actor, eventId, rewardId, dto);
  }
}
