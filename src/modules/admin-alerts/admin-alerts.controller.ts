import { Body, Controller, Delete, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional } from 'class-validator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import { AdminAlertsService } from './admin-alerts.service';

class RecipientDto {
  @IsEmail() email!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@ApiTags('admin-alert-recipients')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ROLE_MANAGE)
@Controller('admin/notification-emails')
export class AdminAlertsController {
  constructor(private readonly service: AdminAlertsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(): ReturnType<AdminAlertsService['listRecipients']> {
    return this.service.listRecipients();
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  save(@Body() dto: RecipientDto): ReturnType<AdminAlertsService['saveRecipient']> {
    return this.service.saveRecipient(dto.email, dto.enabled ?? true);
  }

  @Delete(':email')
  @Header('Cache-Control', 'private, no-store')
  remove(@Param('email') email: string): ReturnType<AdminAlertsService['removeRecipient']> {
    return this.service.removeRecipient(email);
  }
}
