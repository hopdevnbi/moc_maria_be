import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import {
  AdminInquiryFulfillmentController,
  ProviderInquiryFulfillmentController,
} from './inquiry-fulfillment.controller';
import { InquiryFulfillmentService } from './inquiry-fulfillment.service';

@Module({
  imports: [AuthModule, AccessControlModule],
  providers: [InquiryFulfillmentService],
  controllers: [AdminInquiryFulfillmentController, ProviderInquiryFulfillmentController],
})
export class InquiryFulfillmentModule {}
