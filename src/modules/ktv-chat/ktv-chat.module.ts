import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProvidersModule } from '../providers/providers.module';
import { KtvChatController } from './ktv-chat.controller';
import { KtvChatService } from './ktv-chat.service';

@Module({
  imports: [AuthModule, ProvidersModule],
  controllers: [KtvChatController],
  providers: [KtvChatService],
})
export class KtvChatModule {}
