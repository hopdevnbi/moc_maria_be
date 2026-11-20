import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { assertMonitorAccess, KtvChatMonitorService } from './ktv-chat-monitor.service';
function cursor(before?: string): string | undefined {
  if (before === undefined) return undefined;
  if (
    typeof before !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(before) ||
    BigInt(before) > 9223372036854775807n
  )
    throw new BadRequestException('CHAT_CURSOR_INVALID');
  return before;
}
@ApiTags('admin-chat-monitor')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('admin/chat-monitor')
export class KtvChatMonitorController {
  constructor(private readonly monitor: KtvChatMonitorService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() actor: AuthUserContext,
    @Query('before') before?: string,
  ): ReturnType<KtvChatMonitorService['list']> {
    assertMonitorAccess(actor);
    return this.monitor.list(actor, cursor(before));
  }
  @Get('threads/:id')
  @Header('Cache-Control', 'private, no-store')
  thread(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('before') before?: string,
  ): ReturnType<KtvChatMonitorService['list']> {
    assertMonitorAccess(actor);
    return this.monitor.list(actor, cursor(before), id);
  }
}
