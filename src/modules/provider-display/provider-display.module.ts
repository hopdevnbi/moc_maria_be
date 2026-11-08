import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProviderDisplayService } from './provider-display.service';
import { KtvOnboardingService } from './ktv-onboarding.service';
import {
  AdminProviderDisplayController,
  PublicProviderDisplayController,
} from './provider-display.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminProviderDisplayController, PublicProviderDisplayController],
  providers: [ProviderDisplayService, KtvOnboardingService],
  exports: [ProviderDisplayService],
})
export class ProviderDisplayModule {}
