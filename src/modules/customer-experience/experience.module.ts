import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { KtvChatModule } from '../ktv-chat/ktv-chat.module';
import { ProviderDisplayModule } from '../provider-display/provider-display.module';
import {
  CustomerExperienceController,
  PublicPresentationController,
  AdminAppointmentInquiriesController,
} from './experience.controller';
import { CustomerExperienceService } from './experience.service';
import { AdminAppointmentInquiriesService } from './admin-appointment-inquiries.service';
import { ProviderShowcaseController } from './provider-showcase.controller';
import { ProviderShowcaseService } from './provider-showcase.service';
import { ProviderTipsController } from './provider-tips.controller';
import { ProviderTipsService } from './provider-tips.service';
@Module({
  imports: [
    AuthModule,
    AccessControlModule,
    KtvChatModule,
    ProviderDisplayModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
  ],
  controllers: [
    PublicPresentationController,
    CustomerExperienceController,
    AdminAppointmentInquiriesController,
    ProviderShowcaseController,
    ProviderTipsController,
  ],
  providers: [
    CustomerExperienceService,
    AdminAppointmentInquiriesService,
    ProviderShowcaseService,
    ProviderTipsService,
  ],
})
export class CustomerExperienceModule {}
