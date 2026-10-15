import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { AdminAlertsService } from '../admin-alerts/admin-alerts.service';
import { ZaloAlertsService } from '../zalo-alerts/zalo-alerts.service';
import { mocMariaEmailJob } from '../../shared/email/moc-maria-email';

export const giftNoticePrefix = 'mocmaria.gift.notify.';
export type GiftNotice = {
  rewardId: string;
  eventId: string;
  eventTitle: string;
  customerName: string;
  prizeName: string;
  issuedAt: string;
  expiresAt: string;
};

// eslint-disable-next-line no-control-regex -- Strip control characters from untrusted display names.
const clean = (s: string): string => s.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 130);
const htmlEscape = (s: string): string =>
  clean(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
  );

export function giftNoticeText(v: GiftNotice): string {
  return [
    'Mộc Maria · Khách đã mở hộp nhận voucher',
    `Sự kiện: ${clean(v.eventTitle)}`,
    `Khách: ${clean(v.customerName)}`,
    `Quà: ${clean(v.prizeName)}`,
    `Thời điểm: ${new Date(v.issuedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `Hạn dùng: ${new Date(v.expiresAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `Tham chiếu voucher: ${v.rewardId.slice(0, 8)}`,
    'https://mocmaria.com/quan-tri/su-kien/voucher',
  ].join('\n');
}

type NoticeRow = {
  key: string;
  value: GiftNotice & { channel: 'zalo' | 'email'; attempts: number; lease: string };
};

@Injectable()
export class GiftNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GiftNotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly zalo: ZaloAlertsService,
    private readonly adminAlerts: AdminAlertsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.drain(), 15000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Transactional insert: never notify about an uncommitted draw. */
  async enqueue(manager: EntityManager, event: GiftNotice): Promise<void> {
    for (const channel of ['zalo', 'email'] as const) {
      await manager.query(
        `INSERT INTO app_metadata(key,value)
         VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING`,
        [
          giftNoticePrefix + channel + '.' + event.rewardId,
          JSON.stringify({
            ...event,
            channel,
            status: 'pending',
            attempts: 0,
            nextAt: new Date().toISOString(),
          }),
        ],
      );
    }
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let i = 0; i < 10; i++) {
        const [row] = await this.db.query<NoticeRow[]>(
          `WITH candidate AS (
            SELECT key FROM app_metadata
            WHERE key LIKE $1 AND value->>'status'='pending'
              AND (value->>'nextAt')::timestamptz <= clock_timestamp()
            ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1
           ), claimed AS (
            UPDATE app_metadata m SET value=m.value||jsonb_build_object(
              'lease', gen_random_uuid()::text, 'nextAt', clock_timestamp()+interval '90 seconds'),
              updated_at=clock_timestamp()
            FROM candidate c WHERE m.key=c.key RETURNING m.key,m.value
           ) SELECT key,value FROM claimed`,
          [giftNoticePrefix + '%'],
        );
        if (!row) break;
        let sent = false;
        try {
          if (row.value.channel === 'zalo') {
            await this.zalo.enqueueText(
              this.db.manager,
              'gift:' + row.value.rewardId,
              giftNoticeText(row.value),
            );
            sent = (await this.zalo.configuredRecipients()).length > 0;
          } else {
            const saved = await this.adminAlerts.listRecipients();
            const recipients = [...new Set(saved.filter((r) => r.enabled).map((r) => r.email))];
            const base = this.config.get<string>('QUEUE_SERVICE_URL')?.trim();
            const key = this.config.get<string>('QUEUE_API_KEY')?.trim();
            if (recipients.length && base && key) {
              const msg = giftNoticeText(row.value);
              const response = await fetch(base.replace(/\/$/, '') + '/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
                body: JSON.stringify({
                  queue: 'email',
                  name: 'email.send',
                  data: mocMariaEmailJob(
                    {
                      subject: '[Mộc Maria] Khách nhận voucher · ' + clean(row.value.eventTitle),
                      text: msg,
                      html: `<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>Thông báo nhận voucher Mộc Maria</h2><p>${msg.split('\n').map(htmlEscape).join('<br>')}</p></div>`,
                    },
                    recipients,
                    'moc-maria-gift-event',
                    row.value.rewardId,
                  ),
                  options: { jobId: 'moc-maria.gift.' + row.value.rewardId, attempts: 5 },
                }),
                signal: AbortSignal.timeout(8000),
              });
              sent = response.ok;
            }
          }
        } catch {
          // No user-visible side effect; retry the same stable outbox key.
        }
        const attempts = row.value.attempts + 1;
        try {
          await this.db.query(
            `UPDATE app_metadata SET value=(value-'lease')||$2::jsonb, updated_at=clock_timestamp()
             WHERE key=$1 AND value->>'lease'=$3`,
            [
              row.key,
              JSON.stringify({
                status: sent ? 'queued' : attempts >= 12 ? 'failed' : 'pending',
                attempts,
                nextAt: new Date(
                  Date.now() + Math.min(3600000, 10000 * 2 ** Math.min(attempts, 9)),
                ).toISOString(),
                ...(sent ? { queuedAt: new Date().toISOString() } : {}),
              }),
              row.value.lease,
            ],
          );
        } catch {
          this.logger.warn('Gift notification outbox acknowledgement delayed');
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
