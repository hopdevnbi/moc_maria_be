import { Body, Controller, Get, Header, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { AdminIntakeService } from './admin-intake.service';
import { CreateCustomerAccountDto } from './admin-intake.dto';

@ApiTags('Admin - Tiếp nhận và tài khoản khách hàng')
@ApiBearerAuth()
@Controller('admin/intake')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
export class AdminIntakeController {
  constructor(private readonly service: AdminIntakeService) {}
  @Get('options')
  @Header('Cache-Control', 'private, no-store')
  options(
    @CurrentUser() actor: AuthUserContext,
    @Query('q') q?: string,
  ): ReturnType<AdminIntakeService['options']> {
    return this.service.options(actor, q || '');
  }
  @Post('customers')
  @Header('Cache-Control', 'private, no-store')
  create(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateCustomerAccountDto,
  ): ReturnType<AdminIntakeService['createCustomer']> {
    return this.service.createCustomer(actor, dto);
  }
}
