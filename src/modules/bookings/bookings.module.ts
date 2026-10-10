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
import { AdminAlertsController } from '../admin-alerts/admin-alerts.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAlertRecipient } from '../admin-alerts/admin-alert-recipient.entity';
@Module({
  imports: [
    AuthModule,
    AccessControlModule,
    ProvidersModule,
    TypeOrmModule.forFeature([AdminAlertRecipient]),
  ],
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
    AdminAlertsController,
  ],
  exports: [AvailabilityService],
})
export class BookingsModule {}
