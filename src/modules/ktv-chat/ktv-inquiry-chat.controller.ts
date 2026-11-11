import { Controller, Header, Param, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvInquiryChatService } from './ktv-inquiry-chat.service';

@Controller('ktv-chat/inquiries')
@UseGuards(AccessTokenGuard)
export class KtvInquiryChatController {
  constructor(private readonly chat: KtvInquiryChatService) {}
  @Post(':id/support-thread')
  @Header('Cache-Control', 'private, no-store')
  support(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
  ): ReturnType<KtvInquiryChatService['support']> {
    return this.chat.support(actor, id, 'inquiry');
  }
  @Post('support/threads/:id')
  @Header('Cache-Control', 'private, no-store')
  supportThread(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
  ): ReturnType<KtvInquiryChatService['support']> {
    return this.chat.support(actor, id, 'thread');
  }
  @Post(':id/thread')
  @Header('Cache-Control', 'private, no-store')
  open(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
  ): ReturnType<KtvInquiryChatService['open']> {
    return this.chat.open(actor, id);
  }
}
