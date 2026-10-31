import { Global, Module } from '@nestjs/common';
import { ZaloAlertsService } from './zalo-alerts.service';
import { ZaloLinhDanAlertsService } from './zalo-linh-dan-alerts.service';
import { ZaloLinhDanWebhookController } from './zalo-linh-dan-webhook.controller';
import { ChatDigestService } from './chat-digest.service';
import { ChatDigestController } from './chat-digest.controller';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ZaloBotService } from './zalo-bot.service';
import { ZaloWebhookController, ZaloBotAdminController } from './zalo-bot.controller';
import {
  CommunityGiftZaloAuthGuard,
  CommunityGiftZaloController,
} from './community-gift-zalo.controller';

@Global()
@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [
    ChatDigestController,
    ZaloWebhookController,
    ZaloLinhDanWebhookController,
    ZaloBotAdminController,
    CommunityGiftZaloController,
  ],
  providers: [
    ZaloLinhDanAlertsService,
    ZaloAlertsService,
    ChatDigestService,
    ZaloBotService,
    CommunityGiftZaloAuthGuard,
  ],
  exports: [ZaloAlertsService, ChatDigestService],
})
export class ZaloAlertsModule {}
