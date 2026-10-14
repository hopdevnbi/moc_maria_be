import { Module } from '@nestjs/common';
import { ZaloAlertsModule } from './modules/zalo-alerts/zalo-alerts.module';
import { KtvSafetyModule } from './modules/ktv-safety/safety.module';
import { CustomerExperienceModule } from './modules/customer-experience/experience.module';
import { ProviderReviewsModule } from './modules/provider-reviews/provider-reviews.module';
import { KtvChatModule } from './modules/ktv-chat/ktv-chat.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { BranchesModule } from './modules/branches/branches.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ApplicationConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { GlobalExceptionFilter } from './http/global-exception.filter';
import { ApplicationLoggingModule } from './logging/logging.module';
import { AdminAlertsModule } from './modules/admin-alerts/admin-alerts.module';
import { CustomerManagementModule } from './modules/customer-management/customer-management.module';
import { AdminAccessModule } from './modules/admin-access/admin-access.module';
import { ProviderDisplayModule } from './modules/provider-display/provider-display.module';
import { AdminIntakeModule } from './modules/admin-intake/admin-intake.module';
import { InquiryFulfillmentModule } from './modules/inquiry-fulfillment/inquiry-fulfillment.module';

@Module({
  imports: [
    ApplicationConfigModule,
    ZaloAlertsModule,
    ApplicationLoggingModule,
    AdminAlertsModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    AdminUsersModule,
    ProfilesModule,
    BranchesModule,
    CatalogModule,
    ProvidersModule,
    BookingsModule,
    KtvChatModule,
    ProviderReviewsModule,
    CustomerExperienceModule,
    CustomerManagementModule,
    AdminAccessModule,
    ProviderDisplayModule,
    AdminIntakeModule,
    InquiryFulfillmentModule,
    KtvSafetyModule,
  ],
  providers: [GlobalExceptionFilter],
})
export class AppModule {}
