import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KtvChatModule } from '../ktv-chat/ktv-chat.module';
import {
  CustomerExperienceController,
  PublicPresentationController,
} from './experience.controller';
import { CustomerExperienceService } from './experience.service';
@Module({
  imports: [AuthModule, KtvChatModule],
  controllers: [PublicPresentationController, CustomerExperienceController],
  providers: [CustomerExperienceService],
})
export class CustomerExperienceModule {}
