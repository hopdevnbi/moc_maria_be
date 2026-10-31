import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ZaloLinhDanAlertsService } from './zalo-linh-dan-alerts.service';
import { ZaloHoanAlertsService } from './zalo-hoan-alerts.service';

export interface ZaloAlert {
  kind: 'chat' | 'inquiry';
  eventId: string;
  customerName: string;
  senderRole?: 'customer' | 'provider';
  messageBody?: string;
  chatPrivacyProtected?: boolean;
  customerPhone?: string | null;
  customerEmail?: string | null;
  providerName: string;
  providerPhone?: string | null;
  providerEmail?: string | null;
  serviceName?: string;
}
interface Delivery {
  recipient: string;
  text: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  nextAt: string;
  lease?: string;
  sentAt?: string;
  errorCode?: number;
}
export const zaloRecipientPrefix = 'mocmaria.zalo.recipient.';
const prefix = 'mocmaria.zalo.outbox.';
// eslint-disable-next-line no-control-regex -- Strip untrusted name controls from notification lines.
const line = (value: string): string => value.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 120);
const optionalContact = (label: string, value?: string | null): string[] => {
  const cleaned = line(value ?? '').trim();
  return cleaned ? [`${label}: ${cleaned}`] : [];
};
// Preserve readable line breaks while stripping other control characters.
const chatContent = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- Explicitly strip untrusted control characters.
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .slice(0, 2000)
    .split('\n')
    .map((part) => `  ${part}`)
    .join('\n');

export function alertText(alert: ZaloAlert): string {
  return [
    alert.kind === 'inquiry'
      ? 'Mộc Maria · Yêu cầu đặt lịch mới'
      : alert.senderRole === 'provider'
        ? 'Mộc Maria · KTV nhắn khách'
        : 'Mộc Maria · Khách nhắn KTV',
    `Khách: ${line(alert.customerName)}`,
    ...(alert.kind === 'inquiry' ? optionalContact('SĐT khách', alert.customerPhone) : []),
    ...(alert.kind === 'inquiry' ? optionalContact('Email khách', alert.customerEmail) : []),
    `KTV: ${line(alert.providerName)}`,
    ...(alert.kind === 'chat'
      ? [`Người gửi: ${alert.senderRole === 'provider' ? 'KTV' : 'Khách'}`]
      : []),
    ...(alert.kind === 'chat' && alert.chatPrivacyProtected
      ? ['Nội dung: [Hội thoại được bảo vệ bằng mật khẩu]']
      : alert.kind === 'chat' && alert.messageBody
        ? [`Nội dung tin nhắn:\n${chatContent(alert.messageBody)}`]
        : []),
    ...(alert.kind === 'inquiry' ? optionalContact('SĐT KTV', alert.providerPhone) : []),
    ...(alert.kind === 'inquiry' ? optionalContact('Email KTV', alert.providerEmail) : []),
    ...(alert.serviceName ? [`Dịch vụ: ${line(alert.serviceName)}`] : []),
    `Mã ${alert.kind === 'chat' ? 'tin' : 'yêu cầu'}: ${line(alert.eventId)}`,
    'Vui lòng liên hệ KTV để hỗ trợ khách.',
    'https://mocmaria.com/quan-tri/lich-hen',
  ].join('\n');
}

@Injectable()
export class ZaloAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZaloAlertsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    @Optional() private readonly linhDan?: ZaloLinhDanAlertsService,
    @Optional() private readonly hoan?: ZaloHoanAlertsService,
  ) {}

  private settings(): { token: string; recipients: string[] } {
    const token = this.config.get<string>('ZALO_BOT_TOKEN')?.trim() || '';
    const recipients = [
      ...new Set(
        (this.config.get<string>('ZALO_ADMIN_CHAT_IDS') || '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => /^[A-Za-z0-9._-]{1,160}$/.test(id)),
      ),
    ];
    return { token, recipients };
  }

  onModuleInit(): void {
    const { token } = this.settings();
    if (!token || this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      void this.drain();
    }, 2000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Called with the message/inquiry transaction: external HTTP never runs in the request path.
  async enqueue(manager: EntityManager, alert: ZaloAlert): Promise<void> {
    const { token } = this.settings();
    const text = alertText(alert);
    if (token) await this.enqueueText(manager, `${alert.kind}:${alert.eventId}`, text);
    await this.linhDan?.enqueue(manager, alert.eventId, text, alert.kind);
    await this.hoan?.enqueue(manager, alert.eventId, text, alert.kind);
  }

  async configuredRecipients(manager: Pick<EntityManager, 'query'> = this.db): Promise<string[]> {
    const { token, recipients } = this.settings();
    if (!token) return [];
    const saved = await manager.query<{ id: string }[]>(
      `SELECT value->>'chatId' AS id FROM app_metadata WHERE key LIKE $1 AND value->>'enabled'='true'`,
      [zaloRecipientPrefix + '%'],
    );
    return [...new Set([...recipients, ...saved.map((row) => row.id)])].filter((id) =>
      /^[A-Za-z0-9._-]{1,160}$/.test(id),
    );
  }

  async enqueueText(manager: EntityManager, eventId: string, text: string): Promise<void> {
    const { token } = this.settings();
    if (!token) return;
    const recipients = await this.configuredRecipients(manager);
    for (const recipient of recipients) {
      const key = prefix + createHash('sha256').update(`${eventId}:${recipient}`).digest('hex');
      const delivery: Omit<Delivery, 'nextAt'> = {
        recipient,
        text,
        status: 'pending',
        attempts: 0,
      };
      await manager.query(
        `INSERT INTO app_metadata(key,value)
        VALUES($1,$2::jsonb||jsonb_build_object('nextAt',clock_timestamp()))
        ON CONFLICT(key) DO NOTHING`,
        [key, JSON.stringify(delivery)],
      );
    }
  }

  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { token } = this.settings();
      if (!token) return;
      const recipients = await this.configuredRecipients();
      if (!recipients.length) return;
      for (let i = 0; i < 10; i++) {
        const lease = randomUUID();
        // Row locks and a lease allow multiple API replicas without concurrent sends.
        const [row] = await this.db.query<{ key: string; value: Delivery }[]>(
          `
          WITH candidate AS (
            SELECT key FROM app_metadata WHERE key LIKE $1 AND value->>'status'='pending'
              AND (value->>'nextAt')::timestamptz<=clock_timestamp()
              AND value->>'recipient'=ANY($3::text[])
            ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1
          ), claimed AS (UPDATE app_metadata m SET value=m.value||jsonb_build_object('lease',$2::text,
            'nextAt',clock_timestamp()+interval '60 seconds'),updated_at=clock_timestamp()
            FROM candidate c WHERE m.key=c.key RETURNING m.key,m.value)
          SELECT key,value FROM claimed`,
          [prefix + '%', lease, recipients],
        );
        if (!row) break;
        let sent = false;
        let errorCode: number | undefined;
        try {
          const response = await fetch(
            `https://bot-api.zaloplatforms.com/bot${token}/sendMessage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: row.value.recipient, text: row.value.text }),
              signal: AbortSignal.timeout(8000),
            },
          );
          const result = (await response.json()) as {
            ok?: boolean;
            error_code?: number;
            errorCode?: number;
          };
          sent = response.ok && result.ok === true;
          if (!sent) errorCode = result.error_code ?? result.errorCode ?? response.status;
        } catch {
          /* Never log fetch errors: request URLs contain the bot credential. */
        }
        const attempts = row.value.attempts + 1;
        const value: Delivery = {
          ...row.value,
          attempts,
          status: sent ? 'sent' : attempts >= 12 ? 'failed' : 'pending',
          nextAt: new Date(
            Date.now() + Math.min(3600000, 10000 * 2 ** Math.min(attempts, 9)),
          ).toISOString(),
          ...(sent ? { sentAt: new Date().toISOString() } : {}),
          ...(!sent && Number.isInteger(errorCode) ? { errorCode } : {}),
        };
        if (sent) delete value.errorCode;
        delete value.lease;
        await this.db.query(
          `UPDATE app_metadata SET value=$2::jsonb,updated_at=clock_timestamp() WHERE key=$1 AND value->>'lease'=$3`,
          [row.key, JSON.stringify(value), lease],
        );
        if (!sent)
          this.logger.warn(
            `Zalo delivery ${attempts >= 12 ? 'needs operator retry' : 'will retry'} (${row.key.slice(-8)})`,
          );
      }
    } catch {
      this.logger.error('Zalo outbox worker unavailable; pending deliveries retained');
    } finally {
      this.running = false;
    }
  }
}
