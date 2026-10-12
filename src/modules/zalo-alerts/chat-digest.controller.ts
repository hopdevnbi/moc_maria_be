import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import { ChatDigestService, DigestSettings } from './chat-digest.service';
class DigestSettingsDto implements DigestSettings {
  @IsBoolean() enabled!: boolean;
  @IsIn(['daily', 'interval']) mode!: 'daily' | 'interval';
  @IsInt() @Min(0) @Max(23) hour!: number;
  @IsInt() @Min(1) @Max(168) intervalHours!: number;
  @IsBoolean() zalo!: boolean;
  @IsBoolean() email!: boolean;
}
@Controller('admin/chat-digest')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ROLE_MANAGE)
export class ChatDigestController {
  constructor(private readonly digest: ChatDigestService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(): ReturnType<ChatDigestService['getSettings']> {
    return this.digest.getSettings();
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  save(@Body() dto: DigestSettingsDto): ReturnType<ChatDigestService['saveSettings']> {
    return this.digest.saveSettings(dto);
  }
}
