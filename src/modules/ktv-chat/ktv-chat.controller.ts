import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService } from './ktv-chat.service';
import {
  BlockKtvChatDto,
  KtvHistoryDto,
  OpenKtvChatDto,
  ReadKtvChatDto,
  SendKtvMessageDto,
} from './ktv-chat.dto';

@ApiTags('ktv-chat')
@ApiBearerAuth()
@Controller('ktv-chat/threads')
@UseGuards(AccessTokenGuard)
export class KtvChatController {
  constructor(private readonly chat: KtvChatService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthUserContext): ReturnType<KtvChatService['list']> {
    return this.chat.list(actor);
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  open(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: OpenKtvChatDto,
  ): ReturnType<KtvChatService['open']> {
    return this.chat.open(actor, dto.providerApplicationId);
  }
  @Get(':id/messages')
  @Header('Cache-Control', 'private, no-store')
  messages(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: KtvHistoryDto,
  ): ReturnType<KtvChatService['messages']> {
    return this.chat.messages(actor, id, query.before);
  }
  @Post(':id/messages')
  @Header('Cache-Control', 'private, no-store')
  send(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendKtvMessageDto,
  ): ReturnType<KtvChatService['send']> {
    return this.chat.send(actor, id, dto);
  }
  @Post(':id/read')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  read(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReadKtvChatDto,
  ): Promise<void> {
    return this.chat.read(actor, id, dto.lastMessageId);
  }
  @Post(':id/block')
  @Header('Cache-Control', 'private, no-store')
  block(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: BlockKtvChatDto,
  ): ReturnType<KtvChatService['block']> {
    return this.chat.block(actor, id, dto);
  }
  @Post(':id/unblock')
  @Header('Cache-Control', 'private, no-store')
  unblock(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<KtvChatService['unblock']> {
    return this.chat.unblock(actor, id);
  }
}
