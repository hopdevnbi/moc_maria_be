import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import { TrainingService } from './training.service';
import { TrainingController } from './training.controller';
import { ProvidersService } from './providers.service';
import {
  AdminProvidersController,
  ProviderApplicationsController,
  PublicProvidersController,
} from './providers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProviderApplication,
      ProviderCertificate,
      StaffProfile,
      TrainingCourse,
      TrainingEnrollment,
    ]),
    AuthModule,
    AccessControlModule,
  ],
  providers: [ProvidersService, TrainingService],
  controllers: [
    PublicProvidersController,
    ProviderApplicationsController,
    AdminProvidersController,
    TrainingController,
  ],
})
export class ProvidersModule {}
