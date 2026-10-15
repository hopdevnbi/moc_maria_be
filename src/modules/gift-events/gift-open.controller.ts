import { Body, Controller, Header, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { OpenGiftDto, type GiftOpenResult } from './gift-open.dto';
import { GiftOpenService } from './gift-open.service';

@ApiTags('Event - Mở hộp quà (đăng nhập)')
@ApiBearerAuth()
@Controller('gift-events')
@UseGuards(AccessTokenGuard)
export class GiftOpenController {
  constructor(private readonly service: GiftOpenService) {}
  @Post(':eventId/open')
  @Header('Cache-Control', 'private, no-store')
  open(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId') eventId: string,
    @Body() body: OpenGiftDto,
  ): Promise<GiftOpenResult> {
    return this.service.open(actor, eventId, body);
  }
}
