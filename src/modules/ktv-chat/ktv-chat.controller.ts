import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService } from './ktv-chat.service';

class OpenKtvChatDto {
  @IsUUID()
  providerApplicationId!: string;
}

class SendKtvChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

@ApiTags('ktv-chat')
@ApiBearerAuth()
@Controller('ktv-chat')
@UseGuards(AccessTokenGuard)
export class KtvChatController {
  constructor(private readonly service: KtvChatService) {}

  @Header('Cache-Control', 'private, no-store')
  @Get('threads')
  threads(@CurrentUser() actor: AuthUserContext): ReturnType<KtvChatService['list']> {
    return this.service.list(actor);
  }

  @Header('Cache-Control', 'private, no-store')
  @Post('threads')
  open(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: OpenKtvChatDto,
  ): ReturnType<KtvChatService['open']> {
    return this.service.open(actor, dto.providerApplicationId);
  }

  @Header('Cache-Control', 'private, no-store')
  @Get('threads/:id/messages')
  messages(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): ReturnType<KtvChatService['messages']> {
    return this.service.messages(actor, id);
  }

  @Header('Cache-Control', 'private, no-store')
  @Post('threads/:id/messages')
  send(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendKtvChatDto,
  ): ReturnType<KtvChatService['send']> {
    return this.service.send(actor, id, dto.body);
  }
}
