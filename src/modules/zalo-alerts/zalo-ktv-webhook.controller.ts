import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { staffBotBySlug, staffPendingKey } from './zalo-ktv-bots.service';
import { redactCustomerContacts } from './zalo-message-privacy';

type BotEvent = {
  event_name?: string;
  message?: {
    from?: { id?: string; display_name?: string; is_bot?: boolean };
    chat?: { id?: string; chat_type?: string };
    text?: string;
  };
};

@Controller('zalo/ktv')
export class ZaloKtvWebhookController {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  @Post(':slug/webhook')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async receive(
    @Param('slug') slug: string,
    @Headers('x-bot-api-secret-token') supplied: string | undefined,
    @Body() update: BotEvent & { result?: BotEvent },
  ): Promise<{ ok: true }> {
    const bot = staffBotBySlug(slug);
    if (!bot) throw new NotFoundException();
    const expected = this.config.get<string>(bot.env + '_WEBHOOK_SECRET') || '';
    if (!expected || !supplied) throw new UnauthorizedException('Webhook không hợp lệ.');
    const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(supplied), digest(expected)))
      throw new UnauthorizedException('Webhook không hợp lệ.');

    const event = update?.result ?? update;
    const msg = event?.message;
    const chatId = msg?.chat?.id ?? '';
    if (
      event?.event_name !== 'message.text.received' ||
      msg?.from?.is_bot === true ||
      typeof msg?.text !== 'string' ||
      msg?.chat?.chat_type !== 'PRIVATE' ||
      msg.from?.id !== chatId ||
      !/^[A-Za-z0-9._-]{1,160}$/.test(chatId) ||
      msg.text.trim().normalize('NFC') !== 'Kết nối Mộc Maria'
    )
      return { ok: true };

    // Never automatically enable a recipient based on an incoming message.
    // A human operator must confirm chat ID ownership and scope, then place
    // the approved value in the corresponding Kubernetes Secret.
    const key = staffPendingKey(bot, chatId);
    await this.db.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
      [
        key,
        JSON.stringify({
          chatId,
          chatType: msg.chat.chat_type,
          senderName: redactCustomerContacts(msg.from?.display_name ?? '').slice(0, 160),
          receivedAt: new Date().toISOString(),
        }),
      ],
    );
    return { ok: true };
  }
}
