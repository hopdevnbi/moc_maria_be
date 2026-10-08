import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { AdminUsersService } from './admin-users.service';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';

@ApiTags('admin-users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Post('staff')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  createStaff(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateStaffDto,
  ): Promise<unknown> {
    return this.service.createStaff(actor, dto);
  }

  @Patch(':id/roles')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  assignRoles(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') userId: string,
    @Body() dto: AssignRolesDto,
  ): Promise<unknown> {
    return this.service.assignRoles(actor, userId, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  setStatus(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') userId: string,
    @Body() dto: SetUserStatusDto,
  ): Promise<unknown> {
    return this.service.setActive(actor, userId, dto.isActive);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  resetPassword(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') userId: string,
  ): Promise<unknown> {
    return this.service.resetPassword(actor, userId);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  listRoles(): Promise<unknown> {
    return this.service.listRoles();
  }
}
