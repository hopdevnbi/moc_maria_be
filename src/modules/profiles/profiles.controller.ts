import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { UpdateStaffProfileDto } from './dto/update-staff-profile.dto';
import { ProfilesService } from './profiles.service';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller()
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}

  @Get('customers/me')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL)
  getCustomer(@CurrentUser() user: AuthUserContext): Promise<unknown> {
    return this.service.getCustomer(user.id);
  }

  @Patch('customers/me')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL)
  updateCustomer(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: UpdateCustomerProfileDto,
  ): Promise<unknown> {
    return this.service.updateCustomer(user.id, dto);
  }

  @Get('staff/me')
  @RequirePermissions(PERMISSIONS.STAFF_PORTAL)
  getStaff(@CurrentUser() user: AuthUserContext): Promise<unknown> {
    return this.service.getStaff(user);
  }

  @Patch('staff/me')
  @RequirePermissions(PERMISSIONS.STAFF_PORTAL)
  updateStaff(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: UpdateStaffProfileDto,
  ): Promise<unknown> {
    return this.service.updateStaff(user, dto);
  }
}
