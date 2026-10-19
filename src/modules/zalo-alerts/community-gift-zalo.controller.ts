import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { ZaloAlertsService } from './zalo-alerts.service';

class CommunityGiftNotificationDto {
  @IsUUID('4')
  openId!: string;

  @IsUUID('4')
  campaignId!: string;

  @IsString()
  @MaxLength(160)
  familyName!: string;

  @IsInt()
  @Min(1)
  @Max(6)
  boxId!: number;

  @IsBoolean()
  winner!: boolean;

  @IsDateString()
  openedAt!: string;
}

const safeLine = (value: string): string =>
  value.replaceAll('\r', ' ').replaceAll('\n', ' ').slice(0, 160);
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

@Controller('zalo')
export class CommunityGiftZaloController {
  constructor(
    private readonly config: ConfigService,
    private readonly alerts: ZaloAlertsService,
    private readonly db: DataSource,
  ) {}

  @Post('community-gift')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  async receive(
    @Headers('x-community-gift-secret') incoming: string | undefined,
    @Body() dto: CommunityGiftNotificationDto,
  ): Promise<{ accepted: true }> {
    let secret = this.config.get<string>('COMMUNITY_GIFT_ZALO_WEBHOOK_SECRET')?.trim() ?? '';
    if (secret.length < 32) {
      const [stored] = await this.db.query<{ secret: string }[]>(
        'SELECT secret FROM private_integrations.webhook_secrets WHERE key=$1',
        ['community-gift'],
      );
      secret = stored?.secret ?? '';
    }
    if (
      secret.length < 32 ||
      !incoming ||
      incoming.length > 256 ||
      !timingSafeEqual(digest(secret), digest(incoming))
    ) {
      throw new UnauthorizedException('INVALID_EVENT_WEBHOOK');
    }
    // Do not acknowledge until at least one administrator can actually receive.
    if ((await this.alerts.configuredRecipients()).length < 1) {
      throw new ServiceUnavailableException('ZALO_ADMIN_NOT_CONFIGURED');
    }
    const text = [
      'Giáo khu Tân Tây Đô · Hộp Quà Hiệp Thông',
      'Gia đình: ' + safeLine(dto.familyName),
      'Hộp quà: 0' + dto.boxId,
      'Kết quả: ' + (dto.winner ? 'TRÚNG QUÀ ❤️' : 'Chưa trúng quà'),
      'Thời gian: ' +
        new Date(dto.openedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      'Mã lượt: ' + dto.openId.slice(0, 8).toUpperCase(),
      'Trang quản trị: https://giangxa.com/admin/hop-qua-hiep-thong',
    ].join('\n');
    await this.db.transaction(async (manager) => {
      await this.alerts.enqueueText(manager, 'community-gift:' + dto.openId, text);
    });
    return { accepted: true };
  }
}
