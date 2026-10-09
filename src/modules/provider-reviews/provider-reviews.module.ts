import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersModule } from '../providers/providers.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ProviderReviewsService } from './provider-reviews.service';
import {
  AdminProviderReviewsController,
  OwnProviderReviewsController,
  PublicProviderReviewsController,
  PublicProviderRatingsController,
} from './provider-reviews.controller';
@Module({
  imports: [AuthModule, ProvidersModule, AccessControlModule],
  providers: [ProviderReviewsService],
  controllers: [
    PublicProviderReviewsController,
    PublicProviderRatingsController,
    OwnProviderReviewsController,
    AdminProviderReviewsController,
  ],
})
export class ProviderReviewsModule {}
