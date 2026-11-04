import { Module } from '@nestjs/common';
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
@Module({
  imports: [AuthModule, AccessControlModule, KtvChatModule, ProviderDisplayModule],
  controllers: [
    PublicPresentationController,
    CustomerExperienceController,
    AdminAppointmentInquiriesController,
    ProviderShowcaseController,
  ],
  providers: [CustomerExperienceService, AdminAppointmentInquiriesService, ProviderShowcaseService],
})
export class CustomerExperienceModule {}
