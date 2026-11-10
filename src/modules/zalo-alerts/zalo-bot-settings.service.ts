import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

export type ZaloBotId =
  'primary' | 'linh-dan' | 'hoan' | 'tien-manh' | 'tung' | 'nguyet' | 'thanh-thanh';
export type ZaloNotificationKind = 'inquiry' | 'chat' | 'other';

export interface ZaloBotSwitches {
  enabled: boolean;
  bookingEnabled: boolean;
  chatEnabled: boolean;
}

type BotDefinition = {
  id: ZaloBotId;
  label: string;
  category: 'admin' | 'staff';
  tokenEnv: string;
  recipientsEnv: string;
  webhookEnv: string;
  outboxPrefix: string;
  providerEnv?: string;
};

const BOTS: readonly BotDefinition[] = [
  {
    id: 'primary',
    label: 'Bot quản trị chính',
    category: 'admin',
    tokenEnv: 'ZALO_BOT_TOKEN',
    recipientsEnv: 'ZALO_ADMIN_CHAT_IDS',
    webhookEnv: 'ZALO_WEBHOOK_SECRET',
    outboxPrefix: 'mocmaria.zalo.outbox.',
  },
  {
    id: 'linh-dan',
    label: 'Bot Linh Đan',
    category: 'admin',
    tokenEnv: 'ZALO_LINH_DAN_BOT_TOKEN',
    recipientsEnv: 'ZALO_LINH_DAN_CHAT_IDS',
    webhookEnv: 'ZALO_LINH_DAN_WEBHOOK_SECRET',
    outboxPrefix: 'mocmaria.zalo.linh-dan.outbox.',
  },
  {
    id: 'hoan',
    label: 'Bot Hoàn',
    category: 'admin',
    tokenEnv: 'ZALO_HOAN_BOT_TOKEN',
    recipientsEnv: 'ZALO_HOAN_CHAT_IDS',
    webhookEnv: 'ZALO_HOAN_WEBHOOK_SECRET',
    outboxPrefix: 'mocmaria.zalo.hoan.outbox.',
  },
  {
    id: 'tien-manh',
    label: 'Bot KTV Tiến Mạnh',
    category: 'staff',
    tokenEnv: 'ZALO_TIEN_MANH_BOT_TOKEN',
    recipientsEnv: 'ZALO_TIEN_MANH_CHAT_IDS',
    webhookEnv: 'ZALO_TIEN_MANH_WEBHOOK_SECRET',
    providerEnv: 'ZALO_TIEN_MANH_PROVIDER_ID',
    outboxPrefix: 'mocmaria.zalo.staff.tien-manh.outbox.',
  },
  {
    id: 'tung',
    label: 'Bot KTV Tùng',
    category: 'staff',
    tokenEnv: 'ZALO_TUNG_BOT_TOKEN',
    recipientsEnv: 'ZALO_TUNG_CHAT_IDS',
    webhookEnv: 'ZALO_TUNG_WEBHOOK_SECRET',
    providerEnv: 'ZALO_TUNG_PROVIDER_ID',
    outboxPrefix: 'mocmaria.zalo.staff.tung.outbox.',
  },
  {
    id: 'nguyet',
    label: 'Bot KTV Nguyệt',
    category: 'staff',
    tokenEnv: 'ZALO_NGUYET_BOT_TOKEN',
    recipientsEnv: 'ZALO_NGUYET_CHAT_IDS',
    webhookEnv: 'ZALO_NGUYET_WEBHOOK_SECRET',
    providerEnv: 'ZALO_NGUYET_PROVIDER_ID',
    outboxPrefix: 'mocmaria.zalo.staff.nguyet.outbox.',
  },
  {
    id: 'thanh-thanh',
    label: 'Bot KTV Thanh Thanh',
    category: 'staff',
    tokenEnv: 'ZALO_THANH_THANH_BOT_TOKEN',
    recipientsEnv: 'ZALO_THANH_THANH_CHAT_IDS',
    webhookEnv: 'ZALO_THANH_THANH_WEBHOOK_SECRET',
    providerEnv: 'ZALO_THANH_THANH_PROVIDER_ID',
    outboxPrefix: 'mocmaria.zalo.staff.thanh-thanh.outbox.',
  },
] as const;

const settingsKey = (id: ZaloBotId): string => `mocmaria.zalo.bot-settings.${id}`;
const defaultSwitches: ZaloBotSwitches = {
  enabled: true,
  bookingEnabled: true,
  chatEnabled: true,
};
const validRecipient = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(id);
const maskRecipient = (id: string): string =>
  `***${id.length > 6 ? id.slice(-4) : id.length > 3 ? id.slice(-2) : ''}`;

export interface ZaloBotDetails extends ZaloBotSwitches {
  id: ZaloBotId;
  slug: ZaloBotId;
  label: string;
  category: 'admin' | 'staff';
  tokenConfigured: boolean;
  webhookConfigured: boolean;
  webhookUrl: string;
  recipientCount: number;
  maskedRecipients: string[];
  providerId: string | null;
  deliveryCounts: { pending: number; sent: number; failed: number };
}

@Injectable()
export class ZaloBotSettingsService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  private definition(id: string): BotDefinition {
    const bot = BOTS.find((item) => item.id === id);
    if (!bot) throw new NotFoundException('Không tìm thấy bot Zalo.');
    return bot;
  }

  async get(
    id: ZaloBotId,
    manager: Pick<EntityManager, 'query'> = this.db,
  ): Promise<ZaloBotSwitches> {
    this.definition(id);
    const [row] = await manager.query<{ value: Partial<ZaloBotSwitches> }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [settingsKey(id)],
    );
    const saved = row?.value ?? {};
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaultSwitches.enabled,
      bookingEnabled:
        typeof saved.bookingEnabled === 'boolean'
          ? saved.bookingEnabled
          : defaultSwitches.bookingEnabled,
      chatEnabled:
        typeof saved.chatEnabled === 'boolean' ? saved.chatEnabled : defaultSwitches.chatEnabled,
    };
  }

  async allows(
    id: ZaloBotId,
    kind: ZaloNotificationKind,
    manager: Pick<EntityManager, 'query'> = this.db,
  ): Promise<boolean> {
    const settings = await this.get(id, manager);
    return (
      settings.enabled &&
      (kind !== 'inquiry' || settings.bookingEnabled) &&
      (kind !== 'chat' || settings.chatEnabled)
    );
  }

  async update(id: string, input: unknown): Promise<ZaloBotDetails> {
    const bot = this.definition(id);
    if (!input || Array.isArray(input) || typeof input !== 'object') {
      throw new BadRequestException('Cấu hình bot không hợp lệ.');
    }
    const data = input as Record<string, unknown>;
    const keys = Object.keys(data);
    if (
      keys.length === 0 ||
      keys.some(
        (key) =>
          !['enabled', 'bookingEnabled', 'chatEnabled'].includes(key) ||
          typeof data[key] !== 'boolean',
      )
    ) {
      throw new BadRequestException(
        'Chỉ chấp nhận enabled, bookingEnabled, chatEnabled dạng boolean.',
      );
    }
    const patch = Object.fromEntries(keys.map((key) => [key, data[key]]));
    await this.db.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
       ON CONFLICT(key) DO UPDATE SET
         value=app_metadata.value||EXCLUDED.value,updated_at=clock_timestamp()`,
      [settingsKey(bot.id), JSON.stringify(patch)],
    );
    return this.detail(bot.id);
  }

  async list(): Promise<{ bots: ZaloBotDetails[] }> {
    return { bots: await Promise.all(BOTS.map((bot) => this.detail(bot.id))) };
  }

  async detail(id: ZaloBotId): Promise<ZaloBotDetails> {
    const bot = this.definition(id);
    const [switches, savedRecipients, counts] = await Promise.all([
      this.get(bot.id),
      bot.id === 'primary'
        ? this.db.query<{ id: string }[]>(
            `SELECT value->>'chatId' AS id FROM app_metadata
             WHERE key LIKE $1 AND value->>'enabled'='true'`,
            ['mocmaria.zalo.recipient.%'],
          )
        : Promise.resolve([] as { id: string }[]),
      this.db.query<{ status: string; count: string }[]>(
        `SELECT value->>'status' AS status, count(*)::text AS count
         FROM app_metadata WHERE key LIKE $1 AND value->>'status' IN ('pending','sent','failed')
         GROUP BY value->>'status'`,
        [bot.outboxPrefix + '%'],
      ),
    ]);
    const configuredRecipients = (this.config.get<string>(bot.recipientsEnv) || '')
      .split(',')
      .map((value) => value.trim())
      .filter(validRecipient);
    const recipients = [
      ...new Set([...configuredRecipients, ...savedRecipients.map((item) => item.id)]),
    ].filter(validRecipient);
    const deliveryCounts = { pending: 0, sent: 0, failed: 0 };
    for (const row of counts) {
      if (row.status === 'pending' || row.status === 'sent' || row.status === 'failed') {
        deliveryCounts[row.status] = Number(row.count) || 0;
      }
    }
    return {
      id: bot.id,
      slug: bot.id,
      label: bot.label,
      category: bot.category,
      ...switches,
      tokenConfigured: !!this.config.get<string>(bot.tokenEnv)?.trim(),
      webhookConfigured: !!this.config.get<string>(bot.webhookEnv)?.trim(),
      webhookUrl:
        'https://api.mocmaria.com/api/v1/' +
        (bot.id === 'primary'
          ? 'zalo/webhook'
          : bot.category === 'staff'
            ? `zalo/ktv/${bot.id}/webhook`
            : `zalo/${bot.id}/webhook`),
      recipientCount: recipients.length,
      maskedRecipients: recipients.map(maskRecipient),
      providerId: bot.providerEnv ? this.config.get<string>(bot.providerEnv)?.trim() || null : null,
      deliveryCounts,
    };
  }
}
