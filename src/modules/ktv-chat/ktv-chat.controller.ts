import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
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
  KtvChatPasswordDto,
  SetKtvChatPasswordDto,
} from './ktv-chat.dto';

@ApiTags('ktv-chat')
@Controller('ktv-chat/providers')
export class KtvChatDirectoryController {
  constructor(private readonly chat: KtvChatService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  directory(): ReturnType<KtvChatService['directory']> {
    return this.chat.directory();
  }
}

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
  @Post(':id/privacy/password')
  @Header('Cache-Control', 'private, no-store')
  setPassword(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetKtvChatPasswordDto,
  ): ReturnType<KtvChatService['privacyUpdate']> {
    return this.chat.privacyUpdate(actor, id, 'set', dto.password, dto.currentPassword);
  }
  @Post(':id/privacy/unlock')
  @Header('Cache-Control', 'private, no-store')
  unlockPrivacy(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: KtvChatPasswordDto,
  ): ReturnType<KtvChatService['privacyUpdate']> {
    return this.chat.privacyUpdate(actor, id, 'unlock', dto.password);
  }
  @Post(':id/privacy/lock')
  @Header('Cache-Control', 'private, no-store')
  lockPrivacy(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<KtvChatService['privacyUpdate']> {
    return this.chat.privacyUpdate(actor, id, 'lock');
  }
  @Post(':id/privacy/remove')
  @Header('Cache-Control', 'private, no-store')
  removePrivacy(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: KtvChatPasswordDto,
  ): ReturnType<KtvChatService['privacyUpdate']> {
    return this.chat.privacyUpdate(actor, id, 'remove', dto.password);
  }
  @Post(':id/privacy/recover')
  @Header('Cache-Control', 'private, no-store')
  recoverPrivacy(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: KtvChatPasswordDto,
  ): ReturnType<KtvChatService['privacyUpdate']> {
    return this.chat.privacyUpdate(actor, id, 'recover', dto.password);
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
    @Headers('x-chat-unlock') token?: string,
  ): ReturnType<KtvChatService['messages']> {
    return this.chat.messages(actor, id, query.before, token);
  }
  @Post(':id/messages')
  @Header('Cache-Control', 'private, no-store')
  send(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendKtvMessageDto,
    @Headers('x-chat-unlock') token?: string,
  ): ReturnType<KtvChatService['send']> {
    return this.chat.send(actor, id, dto, token);
  }
  @Post(':id/read')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  read(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReadKtvChatDto,
    @Headers('x-chat-unlock') token?: string,
  ): Promise<void> {
    return this.chat.read(actor, id, dto.lastMessageId, token);
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
