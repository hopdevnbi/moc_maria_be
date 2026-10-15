import { Body, Controller, Header, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { OpenGiftDto, type GiftOpenResult } from './gift-open.dto';
import { GiftOpenService } from './gift-open.service';
import { GiftAbuseService } from './gift-abuse.service';

@ApiTags('Event - Mở hộp quà (đăng nhập)')
@ApiBearerAuth()
@Controller('gift-events')
@UseGuards(AccessTokenGuard)
export class GiftOpenController {
  constructor(
    private readonly service: GiftOpenService,
    private readonly abuse: GiftAbuseService,
  ) {}
  @Post(':eventId/open')
  @Header('Cache-Control', 'private, no-store')
  async open(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId') eventId: string,
    @Body() body: OpenGiftDto,
  ): Promise<GiftOpenResult> {
    await this.abuse.consume(actor, 'OPEN', eventId);
    return this.service.open(actor, eventId, body);
  }
}
