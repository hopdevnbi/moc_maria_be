import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Header,
  HttpCode,
  Injectable,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
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

@Injectable()
export class CommunityGiftZaloAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const incoming = request.headers['x-community-gift-secret'];
    // Guards execute before DTO validation, so anonymous empty POSTs return 401.
    // Reject missing/malformed credentials before touching the database.
    if (typeof incoming !== 'string' || incoming.length < 32 || incoming.length > 256) {
      throw new UnauthorizedException('INVALID_EVENT_WEBHOOK');
    }
    let secret = this.config.get<string>('COMMUNITY_GIFT_ZALO_WEBHOOK_SECRET')?.trim() ?? '';
    if (secret.length < 32) {
      const [stored] = await this.db.query<{ secret: string }[]>(
        'SELECT secret FROM private_integrations.webhook_secrets WHERE key=$1',
        ['community-gift'],
      );
      secret = stored?.secret ?? '';
    }
    if (secret.length < 32 || !timingSafeEqual(digest(secret), digest(incoming))) {
      throw new UnauthorizedException('INVALID_EVENT_WEBHOOK');
    }
    return true;
  }
}

@Controller('zalo')
export class CommunityGiftZaloController {
  constructor(
    private readonly alerts: ZaloAlertsService,
    private readonly db: DataSource,
  ) {}

  @Post('community-gift')
  @UseGuards(CommunityGiftZaloAuthGuard)
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  async receive(@Body() dto: CommunityGiftNotificationDto): Promise<{ accepted: true }> {
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
