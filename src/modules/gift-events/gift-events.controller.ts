import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import {
  CreateGiftEventDto,
  UpdateGiftEventDto,
  UpdateGiftServiceRequirementDto,
  EventActionDto,
  EVENT_ACTIONS,
  type EventAction,
} from './gift-events.dto';
import { GiftEventsService } from './gift-events.service';

@ApiTags('Event - Mở hộp quà công khai')
@Controller('gift-events')
export class PublicGiftEventsController {
  constructor(private readonly service: GiftEventsService) {}
  @Get('current')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Chiến dịch hiển thị trên landing theo giờ máy chủ; chưa bật sẽ trả DISABLED',
  })
  current(): ReturnType<GiftEventsService['current']> {
    return this.service.current();
  }
}

@ApiTags('Admin - Sự kiện mở hộp quà')
@ApiBearerAuth()
@Controller('admin/gift-events')
@UseGuards(AccessTokenGuard)
export class AdminGiftEventsController {
  constructor(private readonly service: GiftEventsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthUserContext): ReturnType<GiftEventsService['list']> {
    return this.service.list(actor);
  }
  @Get('tiers')
  @Header('Cache-Control', 'private, no-store')
  tiers(@CurrentUser() actor: AuthUserContext): string[] {
    this.service.requireAdmin(actor);
    return ['STANDARD', ...Array.from({ length: 99 }, (_, i) => 'VIP' + (i + 1))];
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
  ): ReturnType<GiftEventsService['detail']> {
    return this.service.detail(actor, id);
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(
    @CurrentUser() actor: AuthUserContext,
    @Body() body: CreateGiftEventDto,
  ): ReturnType<GiftEventsService['create']> {
    return this.service.create(actor, body);
  }
  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  update(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateGiftEventDto,
  ): ReturnType<GiftEventsService['update']> {
    return this.service.update(actor, id, body);
  }
  @Patch(':id/service-requirement')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Bật/tắt điều kiện khách đã hoàn tất dịch vụ; mặc định tắt' })
  updateServiceRequirement(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() body: UpdateGiftServiceRequirementDto,
  ): ReturnType<GiftEventsService['updateServiceRequirement']> {
    return this.service.updateServiceRequirement(actor, id, body);
  }

  @Post(':id/actions/:action')
  @Header('Cache-Control', 'private, no-store')
  action(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: EventActionDto,
  ): ReturnType<GiftEventsService['action']> {
    if (!EVENT_ACTIONS.includes(action as EventAction))
      throw new BadRequestException('Tác vụ không hợp lệ.');
    return this.service.action(actor, id, action as EventAction, body.expectedVersion, body.reason);
  }
}
