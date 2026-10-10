import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RolesGuard } from '../access-control/guards/roles.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { RequireRoles } from '../access-control/decorators/require-roles.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { VipRequestDto, VipReviewDto, VipSettingsDto, VipMemberStatusDto } from './dto/vip.dto';
import { MembershipService } from './membership.service';

@ApiTags('membership')
@ApiBearerAuth()
@Controller('membership')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL)
export class MembershipController {
  constructor(private readonly service: MembershipService) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser() user: AuthUserContext): Promise<unknown> {
    return this.service.getMe(user.id);
  }

  @Post('requests')
  @Header('Cache-Control', 'private, no-store')
  request(@CurrentUser() user: AuthUserContext, @Body() dto: VipRequestDto): Promise<unknown> {
    return this.service.request(user.id, dto);
  }
}

@ApiTags('admin-membership')
@ApiBearerAuth()
@Controller('admin/membership')
@UseGuards(AccessTokenGuard, PermissionsGuard, RolesGuard)
@RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
@RequireRoles('ADMIN', 'SUPER_ADMIN')
export class AdminMembershipController {
  constructor(private readonly service: MembershipService) {}

  @Get('requests')
  @Header('Cache-Control', 'private, no-store')
  requests(@Query('status') status?: string, @Query('limit') limit?: string): Promise<unknown> {
    return this.service.adminRequests(status, limit);
  }

  @Patch('requests/:id/review')
  @Header('Cache-Control', 'private, no-store')
  review(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: VipReviewDto,
  ): Promise<unknown> {
    return this.service.review(user.id, id, dto);
  }

  @Get('customers')
  @Header('Cache-Control', 'private, no-store')
  customers(@Query('q') q?: string, @Query('limit') limit?: string): Promise<unknown> {
    return this.service.adminCustomers(q, limit);
  }

  @Get('members')
  @Header('Cache-Control', 'private, no-store')
  members(@Query('limit') limit?: string): Promise<unknown> {
    return this.service.adminMembers(limit);
  }

  @Patch('members/:id/status')
  @Header('Cache-Control', 'private, no-store')
  memberStatus(
    @CurrentUser() user: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: VipMemberStatusDto,
  ): Promise<unknown> {
    return this.service.setMemberStatus(user.id, id, dto);
  }

  @Get('settings')
  @Header('Cache-Control', 'private, no-store')
  settings(): Promise<unknown> {
    return this.service.settings();
  }

  @Patch('settings')
  @Header('Cache-Control', 'private, no-store')
  updateSettings(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: VipSettingsDto,
  ): Promise<unknown> {
    return this.service.updateSettings(user.id, dto);
  }
}
