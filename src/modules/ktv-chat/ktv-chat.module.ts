import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersModule } from '../providers/providers.module';
import { KtvChatController, KtvChatDirectoryController } from './ktv-chat.controller';
import { KtvChatService } from './ktv-chat.service';
import { KtvChatPrivacyService } from './ktv-chat-privacy.service';
@Module({
  imports: [AuthModule, ProvidersModule],
  controllers: [KtvChatController, KtvChatDirectoryController],
  providers: [KtvChatService, KtvChatPrivacyService],
  exports: [KtvChatService],
})
export class KtvChatModule {}
