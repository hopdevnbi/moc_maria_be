import { Body, Controller, Get, Header, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { ConfirmInquiryDto, ChangeFulfillmentDto } from './inquiry-fulfillment.dto';
import { InquiryFulfillmentService, type FulfillmentView } from './inquiry-fulfillment.service';

@ApiTags('Admin - Lịch xác nhận và hoàn thành từ yêu cầu')
@ApiBearerAuth()
@Controller('admin/inquiry-fulfillments')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
export class AdminInquiryFulfillmentController {
  constructor(private readonly service: InquiryFulfillmentService) {}

  @Get(':inquiryId')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @CurrentUser() actor: AuthUserContext,
    @Param('inquiryId') inquiryId: string,
  ): Promise<FulfillmentView> {
    return this.service.detail(actor, inquiryId, 'ADMIN');
  }

  @Post(':inquiryId/confirm')
  @Header('Cache-Control', 'private, no-store')
  confirm(
    @CurrentUser() actor: AuthUserContext,
    @Param('inquiryId') inquiryId: string,
    @Body() dto: ConfirmInquiryDto,
  ): Promise<FulfillmentView> {
    return this.service.confirm(actor, inquiryId, dto);
  }

  @Patch(':inquiryId/status')
  @Header('Cache-Control', 'private, no-store')
  change(
    @CurrentUser() actor: AuthUserContext,
    @Param('inquiryId') inquiryId: string,
    @Body() dto: ChangeFulfillmentDto,
  ): Promise<FulfillmentView> {
    return this.service.change(actor, inquiryId, dto, 'ADMIN');
  }
}

@ApiTags('KTV - Xác nhận tiến độ phục vụ')
@ApiBearerAuth()
@Controller('provider/inquiry-fulfillments')
@UseGuards(AccessTokenGuard)
export class ProviderInquiryFulfillmentController {
  constructor(private readonly service: InquiryFulfillmentService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthUserContext): Promise<FulfillmentView[]> {
    return this.service.assigned(actor);
  }

  @Patch(':inquiryId/status')
  @Header('Cache-Control', 'private, no-store')
  change(
    @CurrentUser() actor: AuthUserContext,
    @Param('inquiryId') inquiryId: string,
    @Body() dto: ChangeFulfillmentDto,
  ): Promise<FulfillmentView> {
    return this.service.change(actor, inquiryId, dto, 'PROVIDER');
  }
}
