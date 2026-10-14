import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersModule } from '../providers/providers.module';
import { KtvChatController, KtvChatDirectoryController } from './ktv-chat.controller';
import { KtvChatService } from './ktv-chat.service';
import { KtvChatPrivacyService } from './ktv-chat-privacy.service';
import { ProviderDisplayModule } from '../provider-display/provider-display.module';
@Module({
  imports: [AuthModule, ProvidersModule, ProviderDisplayModule],
  controllers: [KtvChatController, KtvChatDirectoryController],
  providers: [KtvChatService, KtvChatPrivacyService],
  exports: [KtvChatService],
})
export class KtvChatModule {}
