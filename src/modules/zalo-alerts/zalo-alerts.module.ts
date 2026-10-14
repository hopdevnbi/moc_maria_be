import { Global, Module } from '@nestjs/common';
import { ZaloAlertsService } from './zalo-alerts.service';
import { ChatDigestService } from './chat-digest.service';
import { ChatDigestController } from './chat-digest.controller';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ZaloBotService } from './zalo-bot.service';
import { ZaloWebhookController, ZaloBotAdminController } from './zalo-bot.controller';

@Global()
@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [ChatDigestController, ZaloWebhookController, ZaloBotAdminController],
  providers: [ZaloAlertsService, ChatDigestService, ZaloBotService],
  exports: [ZaloAlertsService, ChatDigestService],
})
export class ZaloAlertsModule {}
