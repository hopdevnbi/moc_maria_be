import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    ApplicationConfigModule,
    ApplicationLoggingModule,
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
  ],
  providers: [GlobalExceptionFilter],
})
export class AppModule {}
