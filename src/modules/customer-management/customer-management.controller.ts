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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import {
  CustomerListQueryDto,
  UpdateCustomerNoteDto,
  UpdateCustomerVipDto,
} from './customer-management.dto';
import { CustomerManagementService } from './customer-management.service';

@ApiTags('Admin - Khách hàng & Hội viên VIP')
@ApiBearerAuth()
@Controller('admin/customers')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
export class CustomerManagementController {
  constructor(private readonly service: CustomerManagementService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Danh sách khách, tìm kiếm và lọc trạng thái/VIP có phân trang' })
  list(
    @CurrentUser() actor: AuthUserContext,
    @Query() query: CustomerListQueryDto,
  ): ReturnType<CustomerManagementService['list']> {
    return this.service.list(actor, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Hồ sơ khách và lịch sử chăm sóc/đặt lịch/VIP' })
  detail(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): ReturnType<CustomerManagementService['detail']> {
    return this.service.detail(actor, id);
  }

  @Patch(':id/note')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Lưu ghi chú chăm sóc riêng tư của khách hàng (có audit)' })
  note(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerNoteDto,
  ): ReturnType<CustomerManagementService['updateNote']> {
    return this.service.updateNote(actor, id, dto);
  }

  @Patch(':id/vip')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Cấp/thu hồi VIP thủ công, lý do bắt buộc và ngày hết hạn tùy chọn' })
  vip(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerVipDto,
  ): ReturnType<CustomerManagementService['updateVip']> {
    return this.service.updateVip(actor, id, dto);
  }
}
