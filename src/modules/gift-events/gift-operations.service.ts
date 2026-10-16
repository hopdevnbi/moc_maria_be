import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import type { GiftOperationsFilterDto } from './gift-operations.dto';
import { giftNoticePrefix } from './gift-notifications.service';
import { safeCsvCell } from './gift-report.service';

export function giftOpsRange(from?: string, to?: string): { from: string; to: string } {
  const today = new Date();
  const start = from ?? new Date(today.getTime() - 30 * 86400000).toISOString();
  const end = to ?? today.toISOString();
  const a = Date.parse(start),
    b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || b - a > 366 * 86400000)
    throw new BadRequestException('INVALID_REPORT_DATE_RANGE');
  return { from: new Date(a).toISOString(), to: new Date(b).toISOString() };
}

type NumberRow = {
  eventId: string;
  code: string;
  title: string;
  issued: string;
  redeemed: string;
  voided: string;
  expired: string;
  outstanding: string;
  discountVnd: string;
};
type DayRow = { day: string; issued: string; redeemed: string };
type NoticeRow = { channel: string; status: string; amount: string };
type StockRow = { eventId: string; prizeId: string; name: string; stockLeft: number };

export type GiftOperationsReport = {
  generatedAt: string;
  from: string;
  to: string;
  timezone: 'Asia/Ho_Chi_Minh';
  events: Array<{
    eventId: string;
    code: string;
    title: string;
    issued: number;
    redeemed: number;
    voided: number;
    expired: number;
    outstanding: number;
    discountVnd: number;
  }>;
  daily: Array<{ day: string; issued: number; redeemed: number }>;
  deliveries: Array<{ channel: string; status: string; count: number }>;
  lowStock: StockRow[];
};

@Injectable()
export class GiftOperationsService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}

  async report(
    actor: AuthUserContext,
    filter: GiftOperationsFilterDto,
  ): Promise<GiftOperationsReport> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    const range = giftOpsRange(filter.from, filter.to);
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const args = [filter.eventId || null, range.from, range.to];
      const rows = await m.query<NumberRow[]>(
        `SELECT c.id AS "eventId",c.code,c.title,
          COUNT(r.id)::text issued,
          COUNT(r.id) FILTER(WHERE r.status='REDEEMED')::text redeemed,
          COUNT(r.id) FILTER(WHERE r.status='VOIDED')::text voided,
          COUNT(r.id) FILTER(WHERE r.status='EXPIRED' OR (r.status='ISSUED' AND r.expires_at<=clock_timestamp()))::text expired,
          COUNT(r.id) FILTER(WHERE r.status='ISSUED' AND r.expires_at>clock_timestamp())::text outstanding,
          COALESCE((SELECT SUM((h.metadata->>'discountVnd')::bigint) FROM gift_event_redemption_history h
            JOIN gift_event_rewards rr ON rr.id=h.reward_id
            WHERE rr.event_id=c.id AND h.action='REDEEM' AND rr.redeemed_at >= $2::timestamptz
              AND rr.redeemed_at <= $3::timestamptz AND h.metadata ? 'discountVnd'),0)::text AS "discountVnd"
         FROM gift_event_campaigns c LEFT JOIN gift_event_rewards r ON r.event_id=c.id
           AND r.issued_at >= $2::timestamptz AND r.issued_at <= $3::timestamptz
         WHERE ($1::uuid IS NULL OR c.id=$1) GROUP BY c.id ORDER BY c.start_at DESC NULLS LAST`,
        args,
      );
      const daily = await m.query<DayRow[]>(
        `SELECT TO_CHAR(r.issued_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS "day",
          COUNT(*)::text issued,COUNT(*) FILTER(WHERE r.status='REDEEMED')::text redeemed
         FROM gift_event_rewards r WHERE ($1::uuid IS NULL OR r.event_id=$1)
           AND r.issued_at >= $2::timestamptz AND r.issued_at <= $3::timestamptz
         GROUP BY "day" ORDER BY "day"`,
        args,
      );
      const deliveries = await m.query<NoticeRow[]>(
        `SELECT value->>'channel' AS channel,value->>'status' AS status,COUNT(*)::text amount
         FROM app_metadata WHERE key LIKE $1 AND (value->>'issuedAt')::timestamptz >= $2::timestamptz
           AND (value->>'issuedAt')::timestamptz <= $3::timestamptz
           AND ($4::uuid IS NULL OR value->>'eventId'=$4::text)
         GROUP BY channel,status ORDER BY channel,status`,
        [giftNoticePrefix + '%', range.from, range.to, filter.eventId || null],
      );
      const lowStock = await m.query<StockRow[]>(
        `SELECT p.event_id AS "eventId",p.id AS "prizeId",p.name,
          p.stock_total-p.stock_issued AS "stockLeft"
         FROM gift_event_prizes p WHERE p.enabled AND p.stock_total>0
           AND p.stock_total-p.stock_issued <= GREATEST(2, p.stock_total/10)
           AND ($1::uuid IS NULL OR p.event_id=$1) ORDER BY "stockLeft" LIMIT 30`,
        [filter.eventId || null],
      );
      return {
        generatedAt: new Date().toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        ...range,
        events: rows.map((r) => ({
          ...r,
          issued: Number(r.issued),
          redeemed: Number(r.redeemed),
          voided: Number(r.voided),
          expired: Number(r.expired),
          outstanding: Number(r.outstanding),
          discountVnd: Number(r.discountVnd),
        })),
        daily: daily.map((r) => ({
          day: r.day,
          issued: Number(r.issued),
          redeemed: Number(r.redeemed),
        })),
        deliveries: deliveries.map((r) => ({
          channel: r.channel,
          status: r.status,
          count: Number(r.amount),
        })),
        lowStock,
      };
    });
  }

  async retry(
    actor: AuthUserContext,
    rewardId: string,
    channel: 'zalo' | 'email',
    reason: string,
  ): Promise<{ retried: true }> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    return this.db.transaction(async (m) => {
      const [reward] = await m.query<Array<{ event_id: string }>>(
        'SELECT event_id FROM gift_event_rewards WHERE id=$1::uuid FOR UPDATE',
        [rewardId],
      );
      if (!reward) throw new NotFoundException('REWARD_NOT_FOUND');
      const key = giftNoticePrefix + channel + '.' + rewardId;
      const [updated] = await m.query<Array<{ key: string }>>(
        `UPDATE app_metadata SET value=(value-'lease')||jsonb_build_object('status','pending',
           'attempts',0,'nextAt',clock_timestamp()),updated_at=clock_timestamp()
         WHERE key=$1 AND value->>'status'='failed' RETURNING key`,
        [key],
      );
      if (!updated) throw new ConflictException('ONLY_FAILED_NOTIFICATION_CAN_BE_RETRIED');
      await m.query(
        `INSERT INTO gift_event_admin_audit(event_id,actor_user_id,action,reason,before_snapshot,after_snapshot)
         VALUES($1::uuid,$2::uuid,'GIFT_NOTICE_RETRY',$3,$4::jsonb,$5::jsonb)`,
        [
          reward.event_id,
          actor.id,
          reason.trim(),
          JSON.stringify({ rewardId, channel, status: 'failed' }),
          JSON.stringify({ rewardId, channel, status: 'pending' }),
        ],
      );
      return { retried: true };
    });
  }

  async failedNotices(
    actor: AuthUserContext,
    filter: GiftOperationsFilterDto,
  ): Promise<
    Array<{
      rewardId: string;
      eventId: string;
      channel: string;
      attempts: number;
      issuedAt: string;
    }>
  > {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    const range = giftOpsRange(filter.from, filter.to);
    return this.db.query(
      `SELECT value->>'rewardId' AS "rewardId",value->>'eventId' AS "eventId",
        value->>'channel' AS channel,(value->>'attempts')::int AS attempts,
        value->>'issuedAt' AS "issuedAt"
       FROM app_metadata WHERE key LIKE $1 AND value->>'status'='failed'
         AND (value->>'issuedAt')::timestamptz >= $2::timestamptz
         AND (value->>'issuedAt')::timestamptz <= $3::timestamptz
         AND ($4::uuid IS NULL OR value->>'eventId'=$4::text)
       ORDER BY updated_at DESC LIMIT 50`,
      [giftNoticePrefix + '%', range.from, range.to, filter.eventId || null],
    );
  }
}

export function giftOpsCsv(report: GiftOperationsReport): string {
  const rows: Array<Array<string | number>> = [
    ['Period', report.from, report.to],
    ['Time zone', report.timezone],
    ['Event', 'Code', 'Issued', 'Redeemed', 'Voided', 'Expired', 'Outstanding', 'Discount VND'],
    ...report.events.map((e) => [
      e.title,
      e.code,
      e.issued,
      e.redeemed,
      e.voided,
      e.expired,
      e.outstanding,
      e.discountVnd,
    ]),
    ['Day', 'Issued', 'Redeemed'],
    ...report.daily.map((d) => [d.day, d.issued, d.redeemed]),
    ['Channel', 'Delivery status', 'Count'],
    ...report.deliveries.map((d) => [d.channel, d.status, d.count]),
  ];
  return '\uFEFF' + rows.map((r) => r.map(safeCsvCell).join(',')).join('\r\n') + '\r\n';
}
