import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { BookingTransactionsService } from './booking-transactions.service';
import {
  CreateBookingRequestDto,
  ConfirmBookingQuoteDto,
  ProviderBookingDecisionDto,
  ReviseBookingQuoteDto,
} from './dto/booking-request.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly service: BookingTransactionsService) {}
  @Get('me')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL)
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() actor: AuthUserContext): ReturnType<BookingTransactionsService['list']> {
    return this.service.list(actor.id, 'CUSTOMER');
  }
  @Post('requests')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL)
  @Header('Cache-Control', 'private, no-store')
  request(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateBookingRequestDto,
  ): ReturnType<BookingTransactionsService['create']> {
    return this.service.create(actor.id, dto);
  }
  @Post(':id/confirm-quote')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL)
  @Header('Cache-Control', 'private, no-store')
  confirm(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmBookingQuoteDto,
  ): ReturnType<BookingTransactionsService['confirm']> {
    return this.service.confirm(actor.id, id, dto);
  }
  @Get('provider/me')
  @RequirePermissions(PERMISSIONS.STAFF_PORTAL)
  @Header('Cache-Control', 'private, no-store')
  assigned(@CurrentUser() actor: AuthUserContext): ReturnType<BookingTransactionsService['list']> {
    return this.service.list(actor.id, 'PROVIDER');
  }
  @Post(':id/provider-decision')
  @RequirePermissions(PERMISSIONS.STAFF_PORTAL)
  @Header('Cache-Control', 'private, no-store')
  decide(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProviderBookingDecisionDto,
  ): ReturnType<BookingTransactionsService['decide']> {
    return this.service.decide(actor.id, id, dto);
  }
}
@ApiTags('admin-bookings')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, PermissionsGuard)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly service: BookingTransactionsService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthUserContext): ReturnType<BookingTransactionsService['list']> {
    return this.service.list(actor.id, 'ADMIN');
  }
  @Post(':id/quote')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  revise(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviseBookingQuoteDto,
  ): ReturnType<BookingTransactionsService['revise']> {
    return this.service.revise(actor.id, id, dto);
  }
}
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
