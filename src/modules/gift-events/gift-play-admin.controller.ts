import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftPlayPageQueryDto, GiftPlayResetDto } from './gift-play-admin.dto';
import { GiftPlayAdminService } from './gift-play-admin.service';

@ApiTags('Admin - Lượt mở quà và lịch sử reset')
@ApiBearerAuth()
@Controller('admin/gift-events/:id')
@UseGuards(AccessTokenGuard)
export class GiftPlayAdminController {
  constructor(private readonly plays: GiftPlayAdminService) {}

  @Get('plays')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Danh sách tất cả lần mở quà, gồm cả lượt đã reset' })
  listPlays(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Query() query: GiftPlayPageQueryDto,
  ): ReturnType<GiftPlayAdminService['listPlays']> {
    return this.plays.listPlays(actor, eventId, query);
  }

  @Get('play-resets')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Lịch sử Super Admin reset lượt mở quà' })
  listResets(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Query() query: GiftPlayPageQueryDto,
  ): ReturnType<GiftPlayAdminService['listResets']> {
    return this.plays.listResets(actor, eventId, query);
  }

  @Post('plays/:userId/reset')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Super Admin reset một lượt; quà đã nhận và lịch sử vẫn được giữ nguyên',
  })
  reset(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) customerUserId: string,
    @Body() body: GiftPlayResetDto,
  ): ReturnType<GiftPlayAdminService['reset']> {
    return this.plays.reset(actor, eventId, customerUserId, body);
  }
}
