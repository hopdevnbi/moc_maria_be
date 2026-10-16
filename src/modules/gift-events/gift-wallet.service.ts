import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import { giftCustomerTier } from './gift-open.service';
import { hasCompletedGiftService } from './gift-service-eligibility';
import { type GiftOpenResult } from './gift-open.dto';

type RewardRow = {
  id: string;
  entry_id: string;
  event_id: string;
  prize_id: string;
  status: 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  reward_snapshot: {
    name: string;
    description: string;
    kind: string;
    config: Record<string, unknown>;
    allowedBranchIds: string[];
    liabilityVnd: number;
    termsVersion: number;
  };
  expires_at: Date;
  issued_at: Date;
  redeemed_at: Date | null;
  redeemed_branch_id: string | null;
};
export type WalletReward = {
  id: string;
  openId: string;
  eventId: string;
  prizeId: string;
  name: string;
  description: string;
  kind: string;
  config: Record<string, unknown>;
  allowedBranchIds: string[];
  status: 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  expiresAt: string;
  issuedAt: string;
  redeemedAt: string | null;
  redeemedBranchId: string | null;
};
export type EventMeView = {
  eventId: string | null;
  status: string;
  serverNow: string;
  tier: string;
  eligible: boolean;
  canOpen: boolean;
  reason: string;
  attemptsRemaining: 0 | 1;
  openId: string | null;
  rewardId: string | null;
};

export function hashGiftCounterPin(pin: string): string {
  if (!/^\d{6}$/.test(pin)) throw new ConflictException('INVALID_VOUCHER_CODE');
  const secret = process.env['GIFT_COUNTER_PIN_SECRET'];
  if (!secret || secret.length < 32) throw new ConflictException('VOUCHER_CODE_NOT_CONFIGURED');
  return createHmac('sha256', secret)
    .update('mocmaria-voucher-v1:' + pin)
    .digest('hex');
}

@Injectable()
export class GiftWalletService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}
  private requireCustomer(actor: AuthUserContext): void {
    if (!actor.isActive) throw new ForbiddenException('USER_INACTIVE');
    if (!actor.roles.includes('CUSTOMER'))
      throw new ForbiddenException('CUSTOMER_ACCOUNT_REQUIRED');
  }
  private view(row: RewardRow, now = new Date()): WalletReward {
    const snapshot = row.reward_snapshot;
    return {
      id: row.id,
      openId: row.entry_id,
      eventId: row.event_id,
      prizeId: row.prize_id,
      name: snapshot.name,
      description: snapshot.description,
      kind: snapshot.kind,
      config: snapshot.config,
      allowedBranchIds: snapshot.allowedBranchIds || [],
      status: row.status === 'ISSUED' && new Date(row.expires_at) <= now ? 'EXPIRED' : row.status,
      expiresAt: new Date(row.expires_at).toISOString(),
      issuedAt: new Date(row.issued_at).toISOString(),
      redeemedAt: row.redeemed_at ? new Date(row.redeemed_at).toISOString() : null,
      redeemedBranchId: row.redeemed_branch_id,
    };
  }
  private async reward(actor: AuthUserContext, id: string): Promise<RewardRow> {
    const [row] = await this.db.query<RewardRow[]>(
      `SELECT id,entry_id,event_id,prize_id,status,reward_snapshot,
      expires_at,issued_at,redeemed_at,redeemed_branch_id FROM gift_event_rewards
      WHERE id=$1::uuid AND customer_user_id=$2::uuid`,
      [id, actor.id],
    );
    if (!row) throw new NotFoundException('REWARD_NOT_FOUND');
    return row;
  }
  async me(actor: AuthUserContext): Promise<EventMeView> {
    this.requireCustomer(actor);
    this.events.requireEnabled();
    const now = new Date(),
      current = await this.events.current();
    if (!current.campaign)
      return {
        eventId: null,
        status: current.status,
        serverNow: now.toISOString(),
        tier: 'STANDARD',
        eligible: false,
        canOpen: false,
        reason: 'EVENT_NOT_AVAILABLE',
        attemptsRemaining: 0,
        openId: null,
        rewardId: null,
      };
    const event = current.campaign;
    const [vip] = await this.db.query<Array<{ value: unknown }>>(
      'SELECT value FROM app_metadata WHERE key=$1',
      ['mocmaria.customer.vip.' + actor.id],
    );
    const tier = giftCustomerTier(vip?.value ?? null, now);
    const allowed = event.eligibleTiers.includes(tier);
    const [existing] = await this.db.query<Array<{ id: string; reward_id: string }>>(
      `SELECT e.id,r.id AS reward_id FROM gift_event_entries e
      LEFT JOIN gift_event_rewards r ON r.entry_id=e.id
      WHERE e.event_id=$1::uuid AND e.customer_user_id=$2::uuid`,
      [event.id, actor.id],
    );
    const completedServiceAllowed =
      !event.requiresCompletedService || (await hasCompletedGiftService(this.db.manager, actor.id));
    const active = event.effectiveStatus === 'LIVE';
    let availability = false;
    if (active && allowed && !existing) {
      const [count] = await this.db.query<Array<{ n: number }>>(
        `SELECT COUNT(*)::int n FROM gift_event_prizes p
        WHERE p.event_id=$1::uuid AND p.enabled AND p.kind<>'CASH_COUNTER'
          AND p.stock_total>p.stock_issued AND p.liability_vnd<=$2
          AND EXISTS(SELECT 1 FROM gift_event_prize_branches pb JOIN branches b ON b.id=pb.branch_id
            WHERE pb.prize_id=p.id AND b.is_active)`,
        [event.id, event.budgetCapVnd - event.budgetReservedVnd],
      );
      availability = Number(count?.n || 0) > 0;
    }
    const reason = existing
      ? 'ALREADY_PLAYED'
      : !allowed
        ? 'INELIGIBLE_TIER'
        : !completedServiceAllowed
          ? 'SERVICE_NOT_COMPLETED'
        : !active
          ? event.effectiveStatus === 'SCHEDULED'
            ? 'EVENT_NOT_STARTED'
            : event.effectiveStatus === 'PAUSED'
              ? 'EVENT_PAUSED'
              : 'EVENT_ENDED'
          : !availability
            ? 'EVENT_OUT_OF_STOCK'
            : 'ELIGIBLE';
    return {
      eventId: event.id,
      status: event.effectiveStatus,
      serverNow: now.toISOString(),
      tier,
      eligible: allowed,
      canOpen: reason === 'ELIGIBLE',
      reason,
      attemptsRemaining: reason === 'ELIGIBLE' ? 1 : 0,
      openId: existing?.id || null,
      rewardId: existing?.reward_id || null,
    };
  }
  async list(actor: AuthUserContext): Promise<WalletReward[]> {
    this.requireCustomer(actor);
    this.events.requireEnabled();
    const rows = await this.db.query<RewardRow[]>(
      `SELECT id,entry_id,event_id,prize_id,status,reward_snapshot,
       expires_at,issued_at,redeemed_at,redeemed_branch_id FROM gift_event_rewards
       WHERE customer_user_id=$1::uuid ORDER BY issued_at DESC LIMIT 100`,
      [actor.id],
    );
    return rows.map((row) => this.view(row));
  }
  async detail(actor: AuthUserContext, id: string): Promise<WalletReward> {
    this.requireCustomer(actor);
    this.events.requireEnabled();
    return this.view(await this.reward(actor, id));
  }
  async openResult(actor: AuthUserContext, openId: string): Promise<GiftOpenResult> {
    this.requireCustomer(actor);
    this.events.requireEnabled();
    const [entry] = await this.db.query<
      Array<{
        id: string;
        event_id: string;
        selected_box: number;
        accepted_terms_version: number;
        created_at: Date;
      }>
    >(
      `SELECT id,event_id,selected_box,accepted_terms_version,created_at FROM gift_event_entries
       WHERE id=$1::uuid AND customer_user_id=$2::uuid`,
      [openId, actor.id],
    );
    if (!entry) throw new NotFoundException('OPEN_NOT_FOUND');
    const [row] = await this.db.query<RewardRow[]>(
      `SELECT id,entry_id,event_id,prize_id,status,reward_snapshot,
       expires_at,issued_at,redeemed_at,redeemed_branch_id FROM gift_event_rewards
       WHERE entry_id=$1::uuid AND customer_user_id=$2::uuid`,
      [openId, actor.id],
    );
    if (!row) throw new ConflictException('REWARD_NOT_READY');
    const value = this.view(row);
    return {
      openId: entry.id,
      eventId: entry.event_id,
      boxId: entry.selected_box,
      termsVersion: entry.accepted_terms_version,
      createdAt: new Date(entry.created_at).toISOString(),
      reward: {
        id: value.id,
        prizeId: value.prizeId,
        name: value.name,
        description: value.description,
        kind: value.kind,
        config: value.config,
        expiresAt: value.expiresAt,
        status: value.status,
      },
    };
  }
  async issueQr(
    actor: AuthUserContext,
    rewardId: string,
  ): Promise<{ token: string; expiresAt: string; rewardId: string }> {
    this.requireCustomer(actor);
    this.events.requireEnabled();
    const row = await this.reward(actor, rewardId);
    if (row.status !== 'ISSUED') throw new ConflictException('REWARD_NOT_REDEEMABLE');
    if (new Date(row.expires_at) <= new Date()) throw new ConflictException('REWARD_EXPIRED');
    const raw = randomBytes(32).toString('base64url');
    const hashed = createHash('sha256').update(raw).digest('hex');
    const expiry = new Date(Math.min(Date.now() + 5 * 60_000, new Date(row.expires_at).getTime()));
    await this.db.transaction(async (m) => {
      const [latest] = await m.query<Array<{ status: string; expires_at: Date }>>(
        `SELECT status,expires_at
        FROM gift_event_rewards WHERE id=$1::uuid AND customer_user_id=$2::uuid FOR UPDATE`,
        [rewardId, actor.id],
      );
      if (!latest) throw new NotFoundException('REWARD_NOT_FOUND');
      if (latest.status !== 'ISSUED' || new Date(latest.expires_at) <= new Date())
        throw new ConflictException('REWARD_NOT_REDEEMABLE');
      await m.query(
        `INSERT INTO gift_event_qr_tokens(reward_id,token_hash,expires_at)
         VALUES($1::uuid,$2,$3::timestamptz)
         ON CONFLICT(reward_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
           expires_at=EXCLUDED.expires_at,created_at=clock_timestamp()`,
        [rewardId, hashed, expiry.toISOString()],
      );
    });
    return { token: raw, expiresAt: expiry.toISOString(), rewardId };
  }

  /** Six-digit code must be requested at the counter and expires after five minutes. */
  async issuePin(
    actor: AuthUserContext,
    rewardId: string,
  ): Promise<{ code: string; expiresAt: string; rewardId: string }> {
    this.requireCustomer(actor);
    this.events.requireEnabled();
    // Fail closed before touching the database if the pepper was not provisioned.
    hashGiftCounterPin('000000');
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = String(randomInt(1_000_000)).padStart(6, '0');
      const hashed = hashGiftCounterPin(code);
      try {
        const expiresAt = await this.db.transaction(async (m) => {
          const [row] = await m.query<Array<{ status: string; expires_at: Date }>>(
            `SELECT status,expires_at FROM gift_event_rewards
             WHERE id=$1::uuid AND customer_user_id=$2::uuid FOR UPDATE`,
            [rewardId, actor.id],
          );
          if (!row) throw new NotFoundException('REWARD_NOT_FOUND');
          if (row.status !== 'ISSUED' || new Date(row.expires_at) <= new Date())
            throw new ConflictException('REWARD_NOT_REDEEMABLE');
          const expiry = new Date(
            Math.min(Date.now() + 300000, new Date(row.expires_at).getTime()),
          );
          // Release expired codes to avoid exhausting the six-digit namespace.
          await m.query(
            'DELETE FROM gift_event_counter_pins WHERE expires_at <= clock_timestamp()',
          );
          await m.query(
            `INSERT INTO gift_event_counter_pins(reward_id,pin_hash,expires_at)
             VALUES($1::uuid,$2,$3::timestamptz)
             ON CONFLICT(reward_id) DO UPDATE
               SET pin_hash=EXCLUDED.pin_hash,expires_at=EXCLUDED.expires_at,created_at=clock_timestamp()`,
            [rewardId, hashed, expiry.toISOString()],
          );
          return expiry;
        });
        return { code, rewardId, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        // Another active code matched; generate another rather than disclose or reuse it.
        if ((error as { code?: string }).code === '23505') continue;
        throw error;
      }
    }
    throw new ConflictException('VOUCHER_CODE_BUSY');
  }
}
