import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

type BotEvent = {
  event_name?: string;
  message?: {
    from?: { is_bot?: boolean };
    chat?: { id?: string; chat_type?: string };
    text?: string;
  };
};
export const linhDanPendingPrefix = 'mocmaria.zalo.linh-dan.pending.';

@Controller('zalo/linh-dan')
export class ZaloLinhDanWebhookController {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async receive(
    @Headers('x-bot-api-secret-token') supplied: string | undefined,
    @Body() update: BotEvent & { result?: BotEvent },
  ): Promise<{ ok: true }> {
    const expected = this.config.get<string>('ZALO_LINH_DAN_WEBHOOK_SECRET') || '';
    if (!expected || !supplied) throw new UnauthorizedException('Webhook không hợp lệ.');
    const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
    if (!timingSafeEqual(digest(supplied), digest(expected))) {
      throw new UnauthorizedException('Webhook không hợp lệ.');
    }
    const event = update?.result ?? update;
    const msg = event?.message;
    const id = msg?.chat?.id || '';
    if (
      event?.event_name !== 'message.text.received' ||
      msg?.from?.is_bot === true ||
      typeof msg?.text !== 'string' ||
      !['PRIVATE', 'GROUP'].includes(msg?.chat?.chat_type || '') ||
      !/^[A-Za-z0-9._-]{1,160}$/.test(id) ||
      msg?.text?.trim().normalize('NFC') !== 'Kết nối Mộc Maria'
    )
      return { ok: true };
    // Candidate only: never enroll an arbitrary sender for customer notifications.
    const key = linhDanPendingPrefix + createHash('sha256').update(id).digest('hex');
    await this.db.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
      [
        key,
        JSON.stringify({
          chatId: id,
          chatType: msg.chat!.chat_type,
          receivedAt: new Date().toISOString(),
        }),
      ],
    );
    return { ok: true };
  }
}
