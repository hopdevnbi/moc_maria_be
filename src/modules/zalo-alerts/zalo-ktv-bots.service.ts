import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { privateZaloText } from './zalo-message-privacy';
import { ZaloBotSettingsService } from './zalo-bot-settings.service';

// These are separate BOT identities, not a shared super-admin recipient list.
// Never place a token, chat ID or webhook secret in source code.
export const STAFF_ZALO_BOTS = [
  { slug: 'tien-manh', env: 'ZALO_TIEN_MANH' },
  { slug: 'tung', env: 'ZALO_TUNG' },
  { slug: 'nguyet', env: 'ZALO_NGUYET' },
  { slug: 'thanh-thanh', env: 'ZALO_THANH_THANH' },
] as const;

export type StaffZaloBot = (typeof STAFF_ZALO_BOTS)[number];

export const staffBotBySlug = (slug: string): StaffZaloBot | undefined =>
  STAFF_ZALO_BOTS.find((bot) => bot.slug === slug);

export const staffOutboxPrefix = (bot: StaffZaloBot): string =>
  `mocmaria.zalo.staff.${bot.slug}.outbox.`;
export const staffPendingPrefix = (bot: StaffZaloBot): string =>
  `mocmaria.zalo.staff.${bot.slug}.pending.`;

export function staffPendingKey(bot: StaffZaloBot, chatId: string): string {
  const prefix = staffPendingPrefix(bot);
  // Keep existing short-prefix identities stable; app_metadata.key is varchar(100).
  return (
    prefix +
    createHash('sha256')
      .update(chatId)
      .digest('hex')
      .slice(0, 100 - prefix.length)
  );
}

type Delivery = {
  providerId?: string;
  recipient: string;
  text: string;
  kind?: 'inquiry' | 'chat';
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  nextAt: string;
  lease?: string;
  sentAt?: string;
  errorCode?: number;
};

@Injectable()
export class ZaloKtvBotsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZaloKtvBotsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    @Optional() private readonly botSettings?: ZaloBotSettingsService,
  ) {}

  private settings(bot: StaffZaloBot): { token: string; recipients: string[]; providerId: string } {
    const token = this.config.get<string>(bot.env + '_BOT_TOKEN')?.trim() || '';
    const recipients = [
      ...new Set(
        (this.config.get<string>(bot.env + '_CHAT_IDS') || '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => /^[A-Za-z0-9._-]{1,160}$/.test(id)),
      ),
    ];
    const providerId = this.config.get<string>(bot.env + '_PROVIDER_ID')?.trim() || '';
    return { token, recipients, providerId };
  }

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    if (!STAFF_ZALO_BOTS.some((bot) => this.settings(bot).token)) return;
    this.timer = setInterval(() => void this.drain(), 2000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // The text is formatted using the staff-only PII policy BEFORE persisting.
  // Outboxes share the calling message/booking transaction; retries are
  // idempotent and don't affect the three existing super-admin bots.
  async enqueue(
    manager: EntityManager,
    eventId: string,
    text: string,
    kind: 'inquiry' | 'chat' = 'inquiry',
    providerId?: string,
    senderRole?: 'customer' | 'provider',
  ): Promise<void> {
    // No identity or outgoing KTV reply can fall through to a broadcast.
    if (!providerId || (kind === 'chat' && senderRole !== 'customer')) return;
    for (const bot of STAFF_ZALO_BOTS) {
      const { token, recipients, providerId: owner } = this.settings(bot);
      if (!token || !recipients.length || owner !== providerId) continue;
      if (this.botSettings && !(await this.botSettings.allows(bot.slug, kind, manager))) continue;
      for (const recipient of recipients) {
        const key =
          staffOutboxPrefix(bot) +
          // app_metadata.key is varchar(100); the longest bot prefix needs headroom.
          createHash('sha256').update(`${kind}:${eventId}:${recipient}`).digest('hex').slice(0, 56);
        await manager.query(
          `INSERT INTO app_metadata(key,value)
           VALUES($1,$2::jsonb||jsonb_build_object('nextAt',clock_timestamp()))
           ON CONFLICT(key) DO NOTHING`,
          [
            key,
            JSON.stringify({
              providerId,
              recipient,
              text: privateZaloText(text),
              kind,
              status: 'pending',
              attempts: 0,
            }),
          ],
        );
      }
    }
  }

  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // A broken bot never prevents attempts by the other two bots.
      for (const bot of STAFF_ZALO_BOTS) {
        try {
          await this.drainBot(bot);
        } catch {
          this.logger.error(`Staff Zalo outbox unavailable (${bot.slug}); pending rows retained`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async drainBot(bot: StaffZaloBot): Promise<void> {
    const { token, recipients, providerId } = this.settings(bot);
    if (!token || !recipients.length || !providerId) return;
    const switches = this.botSettings ? await this.botSettings.get(bot.slug) : null;
    if (switches && !switches.enabled) return;
    for (let i = 0; i < 10; i++) {
      const lease = randomUUID();
      const [row] = await this.db.query<{ key: string; value: Delivery }[]>(
        `WITH candidate AS (
          SELECT key FROM app_metadata WHERE key LIKE $1 AND value->>'status'='pending'
            AND (value->>'nextAt')::timestamptz<=clock_timestamp()
            AND value->>'recipient'=ANY($3::text[])
            AND value->>'providerId'=$4
            AND ($5::boolean OR value->>'kind' IS DISTINCT FROM 'inquiry')
            AND ($6::boolean OR value->>'kind' IS DISTINCT FROM 'chat')
          ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1
        ), claimed AS (
          UPDATE app_metadata m SET value=m.value||jsonb_build_object('lease',$2::text,
            'nextAt',clock_timestamp()+interval '60 seconds'),updated_at=clock_timestamp()
          FROM candidate c WHERE m.key=c.key RETURNING m.key,m.value
        ) SELECT key,value FROM claimed`,
        [
          staffOutboxPrefix(bot) + '%',
          lease,
          recipients,
          providerId,
          switches?.bookingEnabled ?? true,
          switches?.chatEnabled ?? true,
        ],
      );
      if (!row) break;

      let sent = false;
      let errorCode: number | undefined;
      try {
        const response = await fetch(`https://bot-api.zaloplatforms.com/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: row.value.recipient,
            text: privateZaloText(row.value.text),
          }),
          signal: AbortSignal.timeout(8000),
        });
        const result = (await response.json()) as {
          ok?: boolean;
          error_code?: number;
          errorCode?: number;
        };
        sent = response.ok && result.ok === true;
        if (!sent) errorCode = result.error_code ?? result.errorCode ?? response.status;
      } catch {
        // HTTP errors may embed the token in their URL. Never log exceptions.
      }

      const attempts = row.value.attempts + 1;
      const value: Delivery = {
        ...row.value,
        attempts,
        status: sent ? 'sent' : attempts >= 12 ? 'failed' : 'pending',
        nextAt: new Date(
          Date.now() + Math.min(3_600_000, 10_000 * 2 ** Math.min(attempts, 9)),
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
      if (!sent) {
        this.logger.warn(
          `Staff Zalo delivery ${attempts >= 12 ? 'needs operator retry' : 'will retry'} (${bot.slug})`,
        );
      }
    }
  }
}
