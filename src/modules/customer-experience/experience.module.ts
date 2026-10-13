import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { KtvChatModule } from '../ktv-chat/ktv-chat.module';
import {
  CustomerExperienceController,
  PublicPresentationController,
  AdminAppointmentInquiriesController,
} from './experience.controller';
import { CustomerExperienceService } from './experience.service';
import { AdminAppointmentInquiriesService } from './admin-appointment-inquiries.service';
@Module({
  imports: [AuthModule, AccessControlModule, KtvChatModule],
  controllers: [
    PublicPresentationController,
    CustomerExperienceController,
    AdminAppointmentInquiriesController,
  ],
  providers: [CustomerExperienceService, AdminAppointmentInquiriesService],
})
export class CustomerExperienceModule {}
