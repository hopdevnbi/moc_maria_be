import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ZaloAlertsService } from './zalo-alerts.service';

export interface DigestSettings {
  enabled: boolean;
  mode: 'daily' | 'interval';
  hour: number;
  intervalHours: number;
  zalo: boolean;
  email: boolean;
}
const defaults: DigestSettings = {
  enabled: true,
  mode: 'daily',
  hour: 9,
  intervalHours: 24,
  zalo: true,
  email: true,
};
const settingsKey = 'mocmaria.chat.digest.settings';
const stateKey = 'mocmaria.chat.digest.state';
const emailPrefix = 'mocmaria.chat.digest.email.';
export function nextDigestAt(settings: DigestSettings, now: Date): Date {
  if (settings.mode === 'interval')
    return new Date(now.getTime() + settings.intervalHours * 3600000);
  const local = new Date(now.getTime() + 7 * 3600000);
  const next = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), settings.hour - 7),
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
interface Summary {
  id: string;
  customer_name: string;
  provider_name: string;
  customer_messages: number;
  provider_messages: number;
  last_seq: string;
  last_at: string;
}
// eslint-disable-next-line no-control-regex -- Name fields must remain single notification lines.
const line = (s: string): string => s.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 100);
export function digestText(row: Summary): string {
  return [
    'Mộc Maria · Báo cáo hội thoại',
    `Khách: ${line(row.customer_name)}`,
    `KTV: ${line(row.provider_name)}`,
    `Tin mới từ khách: ${row.customer_messages}`,
    `Tin mới từ KTV: ${row.provider_messages}`,
    `Hoạt động gần nhất: ${new Date(row.last_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `Mã hội thoại: ${row.id}`,
    'https://mocmaria.com/quan-tri/thong-bao',
  ].join('\n');
}

@Injectable()
export class ChatDigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatDigestService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly zalo: ZaloAlertsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 30000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async getSettings(): Promise<
    DigestSettings & {
      nextAt: string | null;
      zaloReady: boolean;
      emailReady: boolean;
      pending: number;
      failed: number;
    }
  > {
    const [record] = await this.db.query<{ value: DigestSettings }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [settingsKey],
    );
    const [state] = await this.db.query<{ value: { nextAt?: string } }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [stateKey],
    );
    const [status] = await this.db.query<{ pending: number; failed: number }[]>(`SELECT
      count(*) FILTER(WHERE value->>'status' IN ('pending','queued'))::int AS pending,
      count(*) FILTER(WHERE value->>'status'='failed')::int AS failed FROM app_metadata
      WHERE key LIKE 'mocmaria.chat.digest.email.%' OR key LIKE 'mocmaria.zalo.outbox.%'`);
    const emails = await this.db.query<{ email: string }[]>(
      'SELECT email FROM admin_alert_recipients WHERE enabled',
    );
    return {
      ...defaults,
      ...record?.value,
      nextAt: state?.value.nextAt ?? null,
      zaloReady: this.zalo.configuredRecipients().length > 0,
      emailReady:
        !!this.config.get('QUEUE_SERVICE_URL') &&
        !!this.config.get('QUEUE_API_KEY') &&
        emails.length > 0,
      pending: status?.pending ?? 0,
      failed: status?.failed ?? 0,
    };
  }
  async saveSettings(
    input: DigestSettings,
  ): Promise<ReturnType<ChatDigestService['getSettings']> extends Promise<infer T> ? T : never> {
    if (
      !['daily', 'interval'].includes(input.mode) ||
      !Number.isInteger(input.hour) ||
      input.hour < 0 ||
      input.hour > 23 ||
      !Number.isInteger(input.intervalHours) ||
      input.intervalHours < 1 ||
      input.intervalHours > 168 ||
      [input.enabled, input.zalo, input.email].some((v) => typeof v !== 'boolean')
    )
      throw new BadRequestException('Lịch báo cáo không hợp lệ.');
    const settings: DigestSettings = {
      enabled: input.enabled,
      mode: input.mode,
      hour: input.hour,
      intervalHours: input.intervalHours,
      zalo: input.zalo,
      email: input.email,
    };
    await this.db.transaction(async (m) => {
      const [clock] = await m.query<{ now: Date }[]>(
        'SELECT pg_advisory_xact_lock(7240112),clock_timestamp() AS now',
      );
      await this.put(m, settingsKey, settings);
      await this.put(m, stateKey, { nextAt: nextDigestAt(settings, clock.now).toISOString() });
    });
    return this.getSettings();
  }
  private async put(m: EntityManager, key: string, value: unknown): Promise<void> {
    await m.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
      [key, JSON.stringify(value)],
    );
  }
  async collect(at?: Date): Promise<void> {
    await this.db.transaction(async (m) => {
      const [lock] = await m.query<{ locked: boolean; now: Date }[]>(
        'SELECT pg_try_advisory_xact_lock(7240112) AS locked,clock_timestamp() AS now',
      );
      if (!lock.locked) return;
      const now = at ?? lock.now;
      const [record] = await m.query<{ value: DigestSettings }[]>(
        'SELECT value FROM app_metadata WHERE key=$1',
        [settingsKey],
      );
      const settings = { ...defaults, ...record?.value };
      if (!settings.enabled) return;
      const [state] = await m.query<{ value: { nextAt: string } }[]>(
        'SELECT value FROM app_metadata WHERE key=$1',
        [stateKey],
      );
      if (!state) {
        await this.put(m, stateKey, { nextAt: nextDigestAt(settings, now).toISOString() });
        return;
      }
      if (new Date(state.value.nextAt) > now) return;
      const zaloReady = settings.zalo && this.zalo.configuredRecipients().length > 0;
      const emails: { email: string }[] =
        settings.email && this.config.get('QUEUE_SERVICE_URL') && this.config.get('QUEUE_API_KEY')
          ? await m.query('SELECT email FROM admin_alert_recipients WHERE enabled ORDER BY email')
          : [];
      if (!zaloReady && !emails.length) return; // Missing configuration must not consume message watermarks.
      const since = new Date(
        now.getTime() - (settings.mode === 'daily' ? 24 : settings.intervalHours) * 3600000,
      );
      const rows = await m.query<Summary[]>(
        `SELECT t.id,u.display_name AS customer_name,p.public_name AS provider_name,
        count(*) FILTER(WHERE msg.sender_user_id=t.customer_user_id)::int AS customer_messages,
        count(*) FILTER(WHERE msg.sender_user_id=t.provider_user_id)::int AS provider_messages,
        max(msg.seq)::text AS last_seq,max(msg.created_at) AS last_at
        FROM ktv_chat_threads t JOIN users u ON u.id=t.customer_user_id
        JOIN provider_applications p ON p.id=t.provider_application_id
        JOIN ktv_chat_messages msg ON msg.thread_id=t.id
        LEFT JOIN app_metadata mark ON mark.key='mocmaria.chat.digest.watermark.'||t.id::text
        WHERE msg.seq>COALESCE((mark.value->>'seq')::bigint,0)
          AND (mark.key IS NOT NULL OR msg.created_at>=$1) AND msg.created_at<=$2
        GROUP BY t.id,u.display_name,p.public_name ORDER BY t.id`,
        [since, now],
      );
      for (const row of rows) {
        const text = digestText(row);
        const eventId = `digest:${row.id}:${row.last_seq}`;
        if (zaloReady) await this.zalo.enqueueText(m, eventId, text);
        for (const { email } of emails) {
          const key =
            emailPrefix + createHash('sha256').update(`${eventId}:${email}`).digest('hex');
          await m.query(
            `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING`,
            [
              key,
              JSON.stringify({
                recipient: email,
                text,
                threadId: row.id,
                status: 'pending',
                attempts: 0,
                nextAt: now.toISOString(),
              }),
            ],
          );
        }
        await this.put(m, 'mocmaria.chat.digest.watermark.' + row.id, { seq: row.last_seq });
      }
      await this.put(m, stateKey, {
        nextAt: nextDigestAt(settings, now).toISOString(),
        lastRunAt: now.toISOString(),
        threads: rows.length,
      });
      // Keep failed/pending rows; bounded retention for acknowledged deliveries only.
      await m.query(
        `DELETE FROM app_metadata WHERE (key LIKE $1 OR key LIKE 'mocmaria.zalo.outbox.%')
        AND value->>'status'='sent' AND updated_at<clock_timestamp()-interval '30 days'`,
        [emailPrefix + '%'],
      );
    });
  }
  async drainEmail(): Promise<void> {
    const base = this.config.get<string>('QUEUE_SERVICE_URL')?.trim();
    const apiKey = this.config.get<string>('QUEUE_API_KEY')?.trim();
    if (!base || !apiKey) return;
    const queued = await this.db.query<{ key: string }[]>(
      `SELECT key FROM app_metadata
      WHERE key LIKE $1 AND value->>'status'='queued'
      AND (value->>'nextAt')::timestamptz<=clock_timestamp() ORDER BY updated_at LIMIT 20`,
      [emailPrefix + '%'],
    );
    for (const row of queued) {
      let status = 'queued';
      try {
        const response = await fetch(
          base.replace(/\/$/, '') + '/jobs/email/' + encodeURIComponent(row.key),
          {
            headers: { 'X-Api-Key': apiKey },
            signal: AbortSignal.timeout(8000),
          },
        );
        if (response.ok) {
          const job = (await response.json()) as { state?: string };
          if (job.state === 'completed') status = 'sent';
          if (job.state === 'failed') status = 'failed';
        } else if (response.status === 404) status = 'failed';
      } catch {
        /* Queue acknowledgement is retried without resubmitting email. */
      }
      await this.db.query(
        `UPDATE app_metadata SET value=value||$2::jsonb,updated_at=clock_timestamp()
        WHERE key=$1 AND value->>'status'='queued'`,
        [
          row.key,
          JSON.stringify({
            status,
            nextAt: new Date(Date.now() + 30000).toISOString(),
            ...(status === 'sent' ? { sentAt: new Date().toISOString() } : {}),
          }),
        ],
      );
    }
    for (let i = 0; i < 20; i++) {
      const lease = randomUUID();
      const [row] = await this.db.query<
        {
          key: string;
          value: { recipient: string; text: string; threadId: string; attempts: number };
        }[]
      >(
        `WITH candidate AS (SELECT key FROM app_metadata WHERE key LIKE $1 AND value->>'status'='pending'
          AND (value->>'nextAt')::timestamptz<=clock_timestamp() ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
        ,claimed AS (UPDATE app_metadata m SET value=m.value||jsonb_build_object('lease',$2::text,'nextAt',clock_timestamp()+interval '60 seconds'),updated_at=clock_timestamp()
        FROM candidate c WHERE m.key=c.key RETURNING m.key,m.value) SELECT key,value FROM claimed`,
        [emailPrefix + '%', lease],
      );
      if (!row) break;
      let sent = false;
      try {
        const response = await fetch(base.replace(/\/$/, '') + '/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify({
            queue: 'email',
            name: 'email.send',
            data: {
              to: row.value.recipient,
              subject: `[Mộc Maria] Báo cáo chat ${row.value.threadId.slice(0, 8)}`,
              text: row.value.text,
              purpose: 'moc-maria-chat-digest',
              correlationId: row.value.threadId,
            },
            options: { attempts: 5, jobId: row.key },
          }),
          signal: AbortSignal.timeout(8000),
        });
        sent = response.ok;
      } catch {
        /* Keep durable retry state without logging credentials. */
      }
      const attempts = row.value.attempts + 1;
      await this.db.query(
        `UPDATE app_metadata SET value=(value-'lease')||$2::jsonb,updated_at=clock_timestamp()
        WHERE key=$1 AND value->>'lease'=$3`,
        [
          row.key,
          JSON.stringify({
            attempts,
            status: sent ? 'queued' : attempts >= 12 ? 'failed' : 'pending',
            nextAt: new Date(
              Date.now() + Math.min(3600000, 10000 * 2 ** Math.min(attempts, 9)),
            ).toISOString(),
            ...(sent ? { queuedAt: new Date().toISOString() } : {}),
          }),
          lease,
        ],
      );
    }
  }
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.collect();
      await this.drainEmail();
    } catch {
      this.logger.error('Chat digest worker unavailable; pending reports retained');
    } finally {
      this.running = false;
    }
  }
}
