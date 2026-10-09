import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ProvidersModule } from '../providers/providers.module';
import { AvailabilityService } from './availability.service';
import { BookingSettingsService } from './booking-settings.service';
import { AvailabilityController, BookingSettingsController } from './bookings.controller';
@Module({
  imports: [AuthModule, AccessControlModule, ProvidersModule],
  providers: [AvailabilityService, BookingSettingsService],
  controllers: [AvailabilityController, BookingSettingsController],
  exports: [AvailabilityService],
})
export class BookingsModule {}
