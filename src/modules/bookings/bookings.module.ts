import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ProvidersModule } from '../providers/providers.module';
import { AvailabilityService } from './availability.service';
import { BookingSettingsService } from './booking-settings.service';
import {
  AvailabilityController,
  BookingSettingsController,
  BookingsController,
  AdminBookingsController,
} from './bookings.controller';
import { BookingTransactionsService } from './booking-transactions.service';
import { AdminAlertsService } from '../admin-alerts/admin-alerts.service';
@Module({
  imports: [AuthModule, AccessControlModule, ProvidersModule],
  providers: [
    AvailabilityService,
    BookingSettingsService,
    BookingTransactionsService,
    AdminAlertsService,
  ],
  controllers: [
    AvailabilityController,
    BookingSettingsController,
    BookingsController,
    AdminBookingsController,
  ],
  exports: [AvailabilityService],
})
export class BookingsModule {}
