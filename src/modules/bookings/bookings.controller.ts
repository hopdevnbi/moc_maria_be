import { Body, Controller, Get, Header, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { AvailabilityQueryDto, SaveBookingSettingDto } from './dto/availability.dto';
import { AvailabilityService } from './availability.service';
import { BookingSettingsService } from './booking-settings.service';
@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  preview(@Query() query: AvailabilityQueryDto): ReturnType<AvailabilityService['publicPreview']> {
    return this.service.publicPreview(query);
  }
  @Get('earliest')
  @Header('Cache-Control', 'no-store')
  earliest(@Query() query: AvailabilityQueryDto): ReturnType<AvailabilityService['earliest']> {
    return this.service.earliest(query);
  }
}
@ApiTags('admin-booking-settings')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller('admin/booking-settings')
export class BookingSettingsController {
  constructor(private readonly service: BookingSettingsService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  list(): ReturnType<BookingSettingsService['list']> {
    return this.service.list();
  }
  @Post()
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  save(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: SaveBookingSettingDto,
  ): ReturnType<BookingSettingsService['save']> {
    return this.service.save(actor.id, dto);
  }
}
