import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { ProvidersService } from './providers.service';
import {
  AdminProvidersController,
  ProviderApplicationsController,
  PublicProvidersController,
} from './providers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProviderApplication, ProviderCertificate, StaffProfile]),
    AuthModule,
    AccessControlModule,
  ],
  providers: [ProvidersService],
  controllers: [
    PublicProvidersController,
    ProviderApplicationsController,
    AdminProvidersController,
  ],
})
export class ProvidersModule {}
