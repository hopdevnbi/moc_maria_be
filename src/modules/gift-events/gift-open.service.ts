import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { vipLevel } from '../../shared/membership/vip-level';
import type { AuthUserContext } from '../identity/identity.types';
import { effectiveGiftStatus, type GiftEventStatus } from './gift-events.dto';
import { GiftEventsService } from './gift-events.service';
import { type OpenGiftDto, type GiftOpenResult } from './gift-open.dto';

type Campaign = {
  id: string;
  status: GiftEventStatus;
  start_at: Date;
  end_at: Date;
  terms_version: number;
  budget_cap_vnd: string;
  budget_reserved_vnd: string;
};
type Prize = {
  id: string;
  name: string;
  description: string;
  kind: string;
  config: Record<string, unknown>;
  weight: number;
  liability_vnd: string;
  stock_total: number;
  stock_issued: number;
};
type Entry = {
  id: string;
  selected_box: number;
  idempotency_key: string;
  request_fingerprint: string;
  accepted_terms_version: number;
  created_at: Date;
};
type Reward = {
  id: string;
  prize_id: string;
  reward_snapshot: {
    name: string;
    description: string;
    kind: string;
    config: Record<string, unknown>;
  };
  expires_at: Date;
};
export type GiftVipRecord = { isVip?: unknown; level?: unknown; expiresAt?: unknown };

export function giftCustomerTier(value: GiftVipRecord | null, now: Date): string {
  if (!value || value.isVip !== true) return 'STANDARD';
  const expire = value.expiresAt;
  if (
    typeof expire === 'string' &&
    (!Number.isFinite(Date.parse(expire)) || Date.parse(expire) <= now.getTime())
  )
    return 'STANDARD';
  if (expire !== undefined && expire !== null && typeof expire !== 'string') return 'STANDARD';
  return 'VIP' + vipLevel(value.level);
}
export function pickGiftWeighted<T extends { weight: number }>(items: T[], roll: number): T {
  const sum = items.reduce((a, x) => a + x.weight, 0);
  if (!Number.isSafeInteger(sum) || sum <= 0 || !Number.isInteger(roll) || roll < 0 || roll >= sum)
    throw new Error('Invalid prize distribution');
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  throw new Error('No prize selected');
}
const fingerprint = (actorId: string, eventId: string, dto: OpenGiftDto): string =>
  createHash('sha256')
    .update(JSON.stringify([actorId, eventId, dto.boxId, dto.termsVersion]))
    .digest('hex');

@Injectable()
export class GiftOpenService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}

  async open(actor: AuthUserContext, eventId: string, dto: OpenGiftDto): Promise<GiftOpenResult> {
    this.events.requireEnabled();
    if (!actor.isActive) throw new ForbiddenException('USER_INACTIVE');
    // Event-level advisory lock serializes entrants; both stock and budget are
    // additionally updated with DB-level predicates and unique constraints.
    const result = await this.db.transaction(
      async (m): Promise<GiftOpenResult | { paused: true }> => {
        await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'gift.event.open.' + eventId,
        ]);
        const [event] = await m.query<Campaign[]>(
          'SELECT id,status,start_at,end_at,terms_version,budget_cap_vnd,budget_reserved_vnd FROM gift_event_campaigns WHERE id=$1::uuid FOR UPDATE',
          [eventId],
        );
        if (!event) throw new NotFoundException('EVENT_NOT_FOUND');
        const now = new Date();
        const status = effectiveGiftStatus(event.status, event.start_at, event.end_at, now);
        if (status === 'SCHEDULED') throw new ConflictException('EVENT_NOT_STARTED');
        if (status === 'PAUSED') throw new ConflictException('EVENT_PAUSED');
        if (status === 'ENDED' || status === 'ARCHIVED' || status === 'DRAFT')
          throw new ConflictException('EVENT_ENDED');

        const [user] = await m.query<
          Array<{ is_active: boolean; must_change_password: boolean; is_customer: boolean }>
        >(
          `SELECT u.is_active,u.must_change_password,
           EXISTS(SELECT 1 FROM customers c WHERE c.user_id=u.id) AS is_customer
           FROM users u WHERE u.id=$1::uuid FOR SHARE`,
          [actor.id],
        );
        if (!user?.is_active) throw new ForbiddenException('USER_INACTIVE');
        if (user.must_change_password) throw new ForbiddenException('PLEASE_CHANGE_PASSWORD');
        if (!user.is_customer) throw new ForbiddenException('CUSTOMER_ACCOUNT_REQUIRED');

        const fp = fingerprint(actor.id, eventId, dto);
        const [existing] = await m.query<Entry[]>(
          'SELECT * FROM gift_event_entries WHERE event_id=$1::uuid AND customer_user_id=$2::uuid',
          [eventId, actor.id],
        );
        if (existing) {
          if (
            existing.idempotency_key !== dto.idempotencyKey ||
            existing.request_fingerprint !== fp
          )
            throw new ConflictException(
              existing.idempotency_key === dto.idempotencyKey
                ? 'REQUEST_CONFLICT'
                : 'ALREADY_PLAYED',
            );
          return this.resultFromEntry(m, existing, eventId);
        }
        if (Number(event.terms_version) !== dto.termsVersion || dto.termsAccepted !== true)
          throw new BadRequestException('TERMS_VERSION_CHANGED');
        const [vipRow] = await m.query<Array<{ value: GiftVipRecord }>>(
          'SELECT value FROM app_metadata WHERE key=$1',
          ['mocmaria.customer.vip.' + actor.id],
        );
        const tier = giftCustomerTier(vipRow?.value ?? null, now);
        const [eligible] = await m.query<Array<{ tier_code: string }>>(
          'SELECT tier_code FROM gift_event_tiers WHERE event_id=$1::uuid AND tier_code=$2',
          [eventId, tier],
        );
        if (!eligible) throw new ForbiddenException('INELIGIBLE_TIER');

        const availableBudget = Number(event.budget_cap_vnd) - Number(event.budget_reserved_vnd);
        const prizes = await m.query<Prize[]>(
          `SELECT p.id,p.name,p.description,p.kind,p.config,p.weight,
        p.liability_vnd,p.stock_total,p.stock_issued
        FROM gift_event_prizes p
        WHERE p.event_id=$1::uuid AND p.enabled AND p.kind<>'CASH_COUNTER'
          AND p.stock_total>p.stock_issued AND p.liability_vnd<=$2
          AND EXISTS (SELECT 1 FROM gift_event_prize_branches pb
             JOIN branches b ON b.id=pb.branch_id AND b.is_active
             WHERE pb.prize_id=p.id)
        ORDER BY p.id FOR UPDATE`,
          [eventId, availableBudget],
        );
        if (!prizes.length) {
          await m.query(
            `UPDATE gift_event_campaigns SET status='PAUSED',
           pause_reason='Hết quà hoặc hết quỹ phát thưởng',version=version+1,
           updated_by=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,
            [eventId],
          );
          await m.query(
            `INSERT INTO audit_logs(event,metadata) VALUES('GIFT_EVENT_AUTO_PAUSED',$1::jsonb)`,
            [JSON.stringify({ eventId, reason: 'EVENT_OUT_OF_STOCK', at: now.toISOString() })],
          );
          return { paused: true };
        }
        const totalWeight = prizes.reduce((sum, p) => sum + Number(p.weight), 0);
        const winner = pickGiftWeighted(prizes, randomInt(totalWeight));
        const [stock] = await m.query<Array<{ stock_issued: number }>>(
          `UPDATE gift_event_prizes
        SET stock_issued=stock_issued+1 WHERE id=$1::uuid AND stock_issued<stock_total
        RETURNING stock_issued`,
          [winner.id],
        );
        if (!stock) throw new ConflictException('STOCK_CHANGED');
        const [budget] = await m.query<Array<{ budget_reserved_vnd: string }>>(
          `UPDATE gift_event_campaigns
        SET budget_reserved_vnd=budget_reserved_vnd+$2,version=version+1,updated_at=clock_timestamp()
        WHERE id=$1::uuid AND budget_reserved_vnd+$2<=budget_cap_vnd
        RETURNING budget_reserved_vnd`,
          [eventId, Number(winner.liability_vnd)],
        );
        if (!budget) throw new ConflictException('BUDGET_EXHAUSTED');
        const [entry] = await m.query<Entry[]>(
          `INSERT INTO gift_event_entries
        (event_id,customer_user_id,idempotency_key,request_fingerprint,selected_box,accepted_terms_version)
        VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)
        RETURNING id,selected_box,idempotency_key,request_fingerprint,accepted_terms_version,created_at`,
          [eventId, actor.id, dto.idempotencyKey, fp, dto.boxId, dto.termsVersion],
        );
        const validityDays = Number(winner.config['validityDays'] || 30);
        const expiry = new Date(now.getTime() + validityDays * 86400000);
        const branches = await m.query<Array<{ branch_id: string }>>(
          'SELECT branch_id FROM gift_event_prize_branches WHERE prize_id=$1::uuid',
          [winner.id],
        );
        const snapshot = {
          name: winner.name,
          description: winner.description,
          kind: winner.kind,
          config: winner.config,
          allowedBranchIds: branches.map((b) => b.branch_id),
          liabilityVnd: Number(winner.liability_vnd),
          termsVersion: dto.termsVersion,
        };
        const [reward] = await m.query<Reward[]>(
          `INSERT INTO gift_event_rewards
        (entry_id,event_id,prize_id,customer_user_id,reward_snapshot,expires_at)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6::timestamptz)
        RETURNING id,prize_id,reward_snapshot,expires_at`,
          [entry.id, eventId, winner.id, actor.id, JSON.stringify(snapshot), expiry.toISOString()],
        );
        return {
          openId: entry.id,
          eventId,
          boxId: dto.boxId,
          termsVersion: dto.termsVersion,
          createdAt: new Date(entry.created_at).toISOString(),
          reward: {
            id: reward.id,
            prizeId: winner.id,
            name: winner.name,
            description: winner.description,
            kind: winner.kind,
            config: snapshot.config,
            expiresAt: expiry.toISOString(),
            status: 'ISSUED',
          },
        };
      },
    );
    if ('paused' in result) throw new ConflictException('EVENT_OUT_OF_STOCK');
    return result;
  }

  private async resultFromEntry(
    m: EntityManager,
    entry: Entry,
    eventId: string,
  ): Promise<GiftOpenResult> {
    const [reward] = await m.query<Reward[]>(
      `SELECT id,prize_id,reward_snapshot,expires_at FROM gift_event_rewards
      WHERE entry_id=$1::uuid`,
      [entry.id],
    );
    if (!reward) throw new ConflictException('REWARD_NOT_READY');
    const snapshot = reward.reward_snapshot;
    return {
      openId: entry.id,
      eventId,
      boxId: entry.selected_box,
      termsVersion: entry.accepted_terms_version,
      createdAt: new Date(entry.created_at).toISOString(),
      reward: {
        id: reward.id,
        prizeId: reward.prize_id,
        name: snapshot.name,
        description: snapshot.description,
        kind: snapshot.kind,
        config: snapshot.config,
        expiresAt: new Date(reward.expires_at).toISOString(),
        status: 'ISSUED',
      },
    };
  }
}
