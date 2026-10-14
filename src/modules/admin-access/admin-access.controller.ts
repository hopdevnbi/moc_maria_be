import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { AdminAccessService } from './admin-access.service';
import {
  AccessStatusDto,
  AccessUsersQueryDto,
  ProvisionUserDto,
  RoleChangeDto,
} from './admin-access.dto';

@ApiTags('Admin - Phân quyền và tài khoản')
@ApiBearerAuth()
@Controller('admin/access')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ROLE_MANAGE)
export class AdminAccessController {
  constructor(private readonly service: AdminAccessService) {}

  @Get('roles')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Ma trận vai trò và quyền thực tế đang hiệu lực' })
  roles(@CurrentUser() actor: AuthUserContext): ReturnType<AdminAccessService['roles']> {
    return this.service.roles(actor);
  }

  @Get('users')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Danh sách tài khoản, tìm kiếm, lọc theo vai trò/trạng thái và phân trang',
  })
  users(
    @CurrentUser() actor: AuthUserContext,
    @Query() query: AccessUsersQueryDto,
  ): ReturnType<AdminAccessService['users']> {
    return this.service.users(actor, query);
  }

  @Get('users/:id/history')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Lịch sử thay đổi quyền tài khoản' })
  history(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) userId: string,
  ): ReturnType<AdminAccessService['history']> {
    return this.service.history(actor, userId);
  }

  @Post('users')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Tạo tài khoản nhân sự, mật khẩu tạm chỉ trả về một lần' })
  create(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ProvisionUserDto,
  ): ReturnType<AdminAccessService['create']> {
    return this.service.create(actor, dto);
  }

  @Patch('users/:id/role')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Cấp vai trò có audit; cấp/thu hồi Super Admin cần xác nhận và mật khẩu quản trị',
  })
  changeRole(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: RoleChangeDto,
  ): ReturnType<AdminAccessService['changeRole']> {
    return this.service.changeRole(actor, userId, dto);
  }

  @Patch('users/:id/status')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Khóa/mở tài khoản (không được tự khóa hoặc vô hiệu hóa Super Admin cuối cùng)',
  })
  status(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: AccessStatusDto,
  ): ReturnType<AdminAccessService['setStatus']> {
    return this.service.setStatus(actor, userId, dto.isActive, dto);
  }
}
