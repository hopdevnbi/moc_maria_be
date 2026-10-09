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
import { DetailedTrainingService } from './detailed-training.service';
import { DetailedTrainingController } from './detailed-training.controller';
import { ProviderTrustService } from './provider-trust.service';
import { ProviderScheduleService } from './provider-schedule.service';
import { ProviderEligibilityService } from './provider-eligibility.service';
import {
  AdminProviderEligibilityController,
  OwnProviderEligibilityController,
} from './provider-eligibility.controller';
import {
  AdminProviderScheduleController,
  OwnProviderScheduleController,
} from './provider-schedule.controller';
import { TrainingController } from './training.controller';
import { TrainingSessionsService } from './training-sessions.service';
import {
  AdminTrainingSessionsController,
  OwnTrainingSessionsController,
} from './training-sessions.controller';
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
  providers: [
    ProvidersService,
    TrainingService,
    DetailedTrainingService,
    ProviderTrustService,
    ProviderScheduleService,
    ProviderEligibilityService,
    TrainingSessionsService,
  ],
  controllers: [
    PublicProvidersController,
    ProviderApplicationsController,
    AdminProvidersController,
    TrainingController,
    DetailedTrainingController,
    AdminProviderScheduleController,
    OwnProviderScheduleController,
    AdminProviderEligibilityController,
    OwnProviderEligibilityController,
    AdminTrainingSessionsController,
    OwnTrainingSessionsController,
  ],
  exports: [
    ProvidersService,
    ProviderEligibilityService,
    ProviderScheduleService,
    ProviderTrustService,
  ],
})
export class ProvidersModule {}
