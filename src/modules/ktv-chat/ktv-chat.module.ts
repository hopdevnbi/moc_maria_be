import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersModule } from '../providers/providers.module';
import { KtvChatController, KtvChatDirectoryController } from './ktv-chat.controller';
import { KtvChatService } from './ktv-chat.service';
import { KtvChatPrivacyService } from './ktv-chat-privacy.service';
import { KtvChatImageService } from './ktv-chat-image.service';
import { ProviderDisplayModule } from '../provider-display/provider-display.module';
@Module({
  imports: [AuthModule, ProvidersModule, ProviderDisplayModule],
  controllers: [KtvChatController, KtvChatDirectoryController],
  providers: [KtvChatService, KtvChatPrivacyService, KtvChatImageService],
  exports: [KtvChatService],
})
export class KtvChatModule {}
