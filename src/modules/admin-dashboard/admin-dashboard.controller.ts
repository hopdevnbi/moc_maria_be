import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { AdminDashboardService } from './admin-dashboard.service';

@ApiTags('Admin - Operational Dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE, PERMISSIONS.STAFF_MANAGE)
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get('overview')
  @Header('Cache-Control', 'private, no-store')
  overview(
    @CurrentUser() actor: AuthUserContext,
    @Query('period') period?: string,
    @Query('date') date?: string,
  ) {
    return this.service.overview(actor, period ?? 'month', date);
  }

  @Get('providers/:id')
  @Header('Cache-Control', 'private, no-store')
  provider(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('period') period?: string,
    @Query('date') date?: string,
  ) {
    return this.service.providerDetail(actor, id, period ?? 'month', date);
  }
}
