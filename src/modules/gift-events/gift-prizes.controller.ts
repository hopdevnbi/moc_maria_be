import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import { CreateGiftPrizeDto, UpdateGiftPrizeDto } from './gift-prizes.dto';
import { GiftPrizesService } from './gift-prizes.service';
import { GiftEventMediaStorage, type GiftMediaFile } from './gift-event-media.storage';

@ApiBearerAuth()
@ApiTags('Admin - Kho quà Event')
@Controller('admin/gift-events/:eventId/prizes')
@UseGuards(AccessTokenGuard)
export class AdminGiftPrizesController {
  constructor(private readonly service: GiftPrizesService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId') eventId: string,
  ): ReturnType<GiftPrizesService['list']> {
    return this.service.list(actor, eventId);
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId') eventId: string,
    @Body() body: CreateGiftPrizeDto,
  ): ReturnType<GiftPrizesService['create']> {
    return this.service.create(actor, eventId, body);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId') eventId: string,
    @Param('id') id: string,
  ): ReturnType<GiftPrizesService['get']> {
    return this.service.get(actor, eventId, id);
  }
  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  update(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Body() body: UpdateGiftPrizeDto,
  ): ReturnType<GiftPrizesService['update']> {
    return this.service.update(actor, eventId, id, body);
  }
}

@ApiBearerAuth()
@ApiTags('Admin - Media Event')
@Controller('admin/gift-events/:eventId/prize-media')
@UseGuards(AccessTokenGuard)
export class AdminGiftMediaController {
  constructor(
    private readonly events: GiftEventsService,
    private readonly storage: GiftEventMediaStorage,
  ) {}
  @Post()
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() actor: AuthUserContext,
    @Param('eventId') eventId: string,
    @UploadedFile() file: GiftMediaFile | undefined,
  ): Promise<ReturnType<GiftEventMediaStorage['upload']> extends Promise<infer R> ? R : never> {
    const event = await this.events.detail(actor, eventId);
    if (!['DRAFT', 'PAUSED'].includes(event.status))
      throw new BadRequestException('Chỉ tải ảnh khi sự kiện nháp hoặc tạm dừng.');
    return this.storage.upload(eventId, file);
  }
}
