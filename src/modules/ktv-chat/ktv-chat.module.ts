import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersModule } from '../providers/providers.module';
import { KtvChatController, KtvChatDirectoryController } from './ktv-chat.controller';
import { KtvChatService } from './ktv-chat.service';
import { KtvChatPrivacyService } from './ktv-chat-privacy.service';
import { KtvChatImageService } from './ktv-chat-image.service';
import { ProviderDisplayModule } from '../provider-display/provider-display.module';
import { KtvChatPushService } from './ktv-chat-push.service';
import { KtvChatPushController } from './ktv-chat-push.controller';
import { KtvInquiryChatController } from './ktv-inquiry-chat.controller';
import { KtvInquiryChatService } from './ktv-inquiry-chat.service';
@Module({
  imports: [AuthModule, ProvidersModule, ProviderDisplayModule],
  controllers: [
    KtvChatController,
    KtvChatDirectoryController,
    KtvChatPushController,
    KtvInquiryChatController,
  ],
  providers: [
    KtvChatService,
    KtvChatPrivacyService,
    KtvChatImageService,
    KtvChatPushService,
    KtvInquiryChatService,
  ],
  exports: [KtvChatService],
})
export class KtvChatModule {}
