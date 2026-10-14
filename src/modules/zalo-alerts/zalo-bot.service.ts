import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ZaloAlertsService, zaloRecipientPrefix } from './zalo-alerts.service';

const pairKey = 'mocmaria.zalo.pairing';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
type Update = {
  ok?: boolean;
  event_name?: string;
  message?: {
    from?: { id?: string; is_bot?: boolean; display_name?: string };
    chat?: { id?: string; chat_type?: string };
    text?: string;
    message_id?: string;
  };
  result?: {
    event_name?: string;
    message?: {
      from?: { id?: string; is_bot?: boolean; display_name?: string };
      chat?: { id?: string; chat_type?: string };
      text?: string;
      message_id?: string;
    };
  };
};

@Injectable()
export class ZaloBotService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly alerts: ZaloAlertsService,
  ) {}

  async status(): Promise<unknown> {
    const recipients = await this.alerts.configuredRecipients();
    const deliveries = await this.db.query<
      {
        key: string;
        status: string;
        attempts: string;
        errorCode: string | null;
        updatedAt: string;
        recipientSuffix: string;
        sentAt: string | null;
      }[]
    >(`SELECT key,right(value->>'recipient',6) AS recipientSuffix,
      value->>'status' AS status,value->>'attempts' AS attempts,value->>'errorCode' AS "errorCode",
      value->>'sentAt' AS "sentAt",updated_at AS "updatedAt" FROM app_metadata
      WHERE key LIKE 'mocmaria.zalo.outbox.%' ORDER BY updated_at DESC LIMIT 10`);
    const [last] = await this.db.query<{ value: { at: string } }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      ['mocmaria.zalo.webhook.state'],
    );
    return {
      botConfigured: !!this.config.get('ZALO_BOT_TOKEN'),
      webhookConfigured: !!this.config.get('ZALO_WEBHOOK_SECRET'),
      webhookUrl: 'https://api.mocmaria.com/api/v1/zalo/webhook',
      recipientCount: recipients.length,
      recipientSuffixes: recipients.map((id) => id.slice(-6)),
      lastWebhookAt: last?.value?.at ?? null,
      deliveries,
    };
  }

  async createPairing(): Promise<{ command: string; expiresAt: string }> {
    if (!this.config.get('ZALO_BOT_TOKEN') || !this.config.get('ZALO_WEBHOOK_SECRET'))
      throw new BadRequestException('Bot hoặc webhook chưa được cấu hình.');
    const code = randomBytes(8).toString('hex').toUpperCase();
    const [row] = await this.db.query<{ expiresAt: string }[]>(
      `INSERT INTO app_metadata(key,value)
      VALUES($1,jsonb_build_object('hash',$2::text,'expiresAt',clock_timestamp()+interval '30 minutes'))
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()
      RETURNING value->>'expiresAt' AS "expiresAt"`,
      [pairKey, hash(code)],
    );
    return { command: 'Kết nối Mộc Maria ' + code, expiresAt: row.expiresAt };
  }

  async receive(secret: string | undefined, update: Update): Promise<{ ok: true }> {
    const configured = this.config.get<string>('ZALO_WEBHOOK_SECRET') || '';
    if (
      !configured ||
      !secret ||
      !timingSafeEqual(Buffer.from(hash(configured)), Buffer.from(hash(secret)))
    )
      throw new UnauthorizedException('Webhook không hợp lệ.');
    // Some deliveries use the bare event while API examples wrap it in ok/result.
    const event = update?.result ?? update;
    const msg = event?.message;
    const match =
      typeof msg?.text === 'string'
        ? /^Kết nối Mộc Maria\s+([A-F0-9]{16})$/iu.exec(msg.text.trim().normalize('NFC'))
        : null;
    await this.db.query(
      `INSERT INTO app_metadata(key,value) VALUES('mocmaria.zalo.webhook.state',$1::jsonb||jsonb_build_object('at',clock_timestamp()))
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
      [
        JSON.stringify({
          eventName: event?.event_name ?? null,
          envelopeKeys: Object.keys(update ?? {}).slice(0, 12),
          eventKeys: Object.keys(event ?? {}).slice(0, 12),
          messageKeys: Object.keys(msg ?? {}).slice(0, 12),
          fromKeys: Object.keys(msg?.from ?? {}).slice(0, 12),
          chatKeys: Object.keys(msg?.chat ?? {}).slice(0, 12),
          pairingCommandDetected: !!match,
        }),
      ],
    );
    // Only a valid private pairing code can enroll a recipient; probes never do.
    if (event?.event_name !== 'message.text.received') return { ok: true };
    if (
      !msg ||
      msg.from?.is_bot === true ||
      !/^[A-Za-z0-9._-]{1,160}$/.test(msg.chat?.id || '') ||
      !['PRIVATE', 'GROUP'].includes(msg.chat?.chat_type || '')
    )
      return { ok: true };
    await this.db.transaction(async (m) => {
      if (!match) return;
      const [pair] = await m.query<{ value: { hash: string }; valid: boolean }[]>(
        `SELECT value,
        (value->>'expiresAt')::timestamptz>clock_timestamp() AS valid FROM app_metadata WHERE key=$1 FOR UPDATE`,
        [pairKey],
      );
      if (!pair?.valid || pair.value.hash !== hash(match[1].toUpperCase())) return;
      const chatId = msg.chat!.id!;
      await m.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
        [
          zaloRecipientPrefix + hash(chatId),
          JSON.stringify({ chatId, enabled: true, chatType: msg.chat!.chat_type }),
        ],
      );
      await m.query('DELETE FROM app_metadata WHERE key=$1', [pairKey]);
      await this.alerts.enqueueText(
        m,
        'connected:' + hash(match[1].toUpperCase()),
        'Mộc Maria · Đã kết nối thông báo thành công.\nBạn sẽ nhận yêu cầu đặt lịch mới và báo cáo chat Khách – KTV theo lịch trong quản trị.\nhttps://mocmaria.com/quan-tri/thong-bao',
      );
    });
    return { ok: true };
  }

  async test(): Promise<{ queued: true; reference: string }> {
    if (!(await this.alerts.configuredRecipients()).length)
      throw new BadRequestException('Chưa có người nhận. Hãy kết nối Bot trước.');
    const reference = randomUUID();
    await this.db.transaction((m) =>
      this.alerts.enqueueText(
        m,
        'test:' + reference,
        'Mộc Maria · Kiểm tra thông báo Zalo\nKết nối hoạt động. Đây là thông báo kiểm tra, không tạo lịch hẹn hoặc hội thoại.\nMã kiểm tra: ' +
          reference,
      ),
    );
    return { queued: true, reference };
  }
}
