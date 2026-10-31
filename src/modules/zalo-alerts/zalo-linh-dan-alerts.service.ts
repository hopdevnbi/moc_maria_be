import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

type Delivery = {
  recipient: string;
  text: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  nextAt: string;
  lease?: string;
  sentAt?: string;
  errorCode?: number;
};

// The existing bot's outbox and recipient registry are deliberately untouched.
export const linhDanOutboxPrefix = 'mocmaria.zalo.linh-dan.outbox.';

@Injectable()
export class ZaloLinhDanAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZaloLinhDanAlertsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  private settings(): { token: string; recipients: string[] } {
    const token = this.config.get<string>('ZALO_LINH_DAN_BOT_TOKEN')?.trim() || '';
    const recipients = [
      ...new Set(
        (this.config.get<string>('ZALO_LINH_DAN_CHAT_IDS') || '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => /^[A-Za-z0-9._-]{1,160}$/.test(id)),
      ),
    ];
    return { token, recipients };
  }

  onModuleInit(): void {
    if (!this.settings().token || this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.drain(), 2000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Only user-created booking inquiries enter this independent channel.
  async enqueue(manager: EntityManager, eventId: string, text: string): Promise<void> {
    const { token, recipients } = this.settings();
    if (!token || !recipients.length) return;
    for (const recipient of recipients) {
      const key =
        linhDanOutboxPrefix +
        createHash('sha256').update(`inquiry:${eventId}:${recipient}`).digest('hex');
      await manager.query(
        `INSERT INTO app_metadata(key,value)
         VALUES($1,$2::jsonb||jsonb_build_object('nextAt',clock_timestamp()))
         ON CONFLICT(key) DO NOTHING`,
        [key, JSON.stringify({ recipient, text, status: 'pending', attempts: 0 })],
      );
    }
  }

  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { token, recipients } = this.settings();
      if (!token || !recipients.length) return;
      for (let i = 0; i < 10; i++) {
        const lease = randomUUID();
        const [row] = await this.db.query<{ key: string; value: Delivery }[]>(
          `WITH candidate AS (
            SELECT key FROM app_metadata WHERE key LIKE $1 AND value->>'status'='pending'
              AND (value->>'nextAt')::timestamptz<=clock_timestamp()
              AND value->>'recipient'=ANY($3::text[])
            ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1
          ), claimed AS (
            UPDATE app_metadata m SET value=m.value||jsonb_build_object('lease',$2::text,
              'nextAt',clock_timestamp()+interval '60 seconds'),updated_at=clock_timestamp()
            FROM candidate c WHERE m.key=c.key RETURNING m.key,m.value
          ) SELECT key,value FROM claimed`,
          [linhDanOutboxPrefix + '%', lease, recipients],
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
          // Transport errors may contain credential-bearing request URLs. Never log them.
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
          `UPDATE app_metadata SET value=$2::jsonb,updated_at=clock_timestamp()
           WHERE key=$1 AND value->>'lease'=$3`,
          [row.key, JSON.stringify(value), lease],
        );
        if (!sent)
          this.logger.warn(
            `Secondary Zalo delivery ${attempts >= 12 ? 'needs operator retry' : 'will retry'} (${row.key.slice(-8)})`,
          );
      }
    } catch {
      this.logger.error('Secondary Zalo outbox worker unavailable; pending deliveries retained');
    } finally {
      this.running = false;
    }
  }
}
