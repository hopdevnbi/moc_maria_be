import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import type { GiftPlayPageQueryDto, GiftPlayResetDto } from './gift-play-admin.dto';

type PlayRow = {
  id: string;
  customer_user_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  selected_box: number;
  created_at: Date;
  reset_at: Date | null;
  reward_id: string | null;
  reward_status: string | null;
  prize_id: string | null;
  prize_name: string | null;
};
type ResetRow = {
  id: string;
  event_id: string;
  entry_id: string;
  reward_id: string;
  customer_user_id: string;
  customer_name: string;
  customer_phone: string | null;
  actor_user_id: string;
  actor_name: string;
  reason: string;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  created_at: Date;
};
type EntryToReset = { id: string; selected_box: number; created_at: Date };
type RewardToReset = { id: string; prize_id: string; status: string };
type Page<T> = { items: T[]; total: number; limit: number; offset: number };
export type GiftPlayItem = {
  openId: string;
  userId: string;
  customerUserId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  boxId: number;
  playedAt: string;
  resetAt: string | null;
  active: boolean;
  rewardId: string | null;
  rewardStatus: string | null;
  prizeId: string | null;
  prizeName: string | null;
};
export type GiftPlayResetItem = {
  id: string;
  eventId: string;
  openId: string;
  rewardId: string;
  customerUserId: string;
  customerName: string;
  customerPhone: string | null;
  actorUserId: string;
  actorName: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
};
export type GiftResetResult = {
  id: string;
  eventId: string;
  customerUserId: string;
  openId: string;
  rewardId: string;
  actorUserId: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
};

@Injectable()
export class GiftPlayAdminService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}

  private page(query: GiftPlayPageQueryDto): { search: string; limit: number; offset: number } {
    const limit = Number(query?.limit ?? 20);
    const offset = Number(query?.offset ?? 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 1000000
    )
      throw new ConflictException('INVALID_PAGE');
    return { search: '%' + (query?.search || '').trim().slice(0, 100) + '%', limit, offset };
  }

  async listPlays(
    actor: AuthUserContext,
    eventId: string,
    query: GiftPlayPageQueryDto,
  ): Promise<Page<GiftPlayItem>> {
    await this.events.detail(actor, eventId);
    const { search, limit, offset } = this.page(query);
    const filter =
      'e.event_id=$1::uuid AND (u.display_name ILIKE $2 OR ' +
      "COALESCE(u.phone,'') ILIKE $2 OR COALESCE(u.email,'') ILIKE $2 OR " +
      'u.id::text ILIKE $2)';
    const [count] = await this.db.query<Array<{ total: string }>>(
      'SELECT COUNT(*)::text AS total FROM gift_event_entries e ' +
        'JOIN users u ON u.id=e.customer_user_id WHERE ' +
        filter,
      [eventId, search],
    );
    const rows = await this.db.query<PlayRow[]>(
      'SELECT e.id,e.customer_user_id,u.display_name,u.email,u.phone,e.selected_box,' +
        'e.created_at,e.reset_at,r.id AS reward_id,r.status AS reward_status,' +
        'r.prize_id,p.name AS prize_name FROM gift_event_entries e ' +
        'JOIN users u ON u.id=e.customer_user_id ' +
        'LEFT JOIN gift_event_rewards r ON r.entry_id=e.id ' +
        'LEFT JOIN gift_event_prizes p ON p.id=r.prize_id WHERE ' +
        filter +
        ' ORDER BY e.created_at DESC,e.id DESC LIMIT $3 OFFSET $4',
      [eventId, search, limit, offset],
    );
    return {
      items: rows.map((row) => ({
        openId: row.id,
        userId: row.customer_user_id,
        customerUserId: row.customer_user_id,
        displayName: row.display_name,
        email: row.email,
        phone: row.phone,
        boxId: row.selected_box,
        playedAt: new Date(row.created_at).toISOString(),
        resetAt: row.reset_at ? new Date(row.reset_at).toISOString() : null,
        active: !row.reset_at,
        rewardId: row.reward_id,
        rewardStatus: row.reward_status,
        prizeId: row.prize_id,
        prizeName: row.prize_name,
      })),
      total: Number(count?.total || 0),
      limit,
      offset,
    };
  }

  async listResets(
    actor: AuthUserContext,
    eventId: string,
    query: GiftPlayPageQueryDto,
  ): Promise<Page<GiftPlayResetItem>> {
    await this.events.detail(actor, eventId);
    const { search, limit, offset } = this.page(query);
    const filter =
      'pr.event_id=$1::uuid AND (customer.display_name ILIKE $2 OR ' +
      "COALESCE(customer.phone,'') ILIKE $2 OR COALESCE(customer.email,'') ILIKE $2 OR " +
      'actor.display_name ILIKE $2 OR pr.customer_user_id::text ILIKE $2)';
    const joins =
      ' FROM gift_event_play_resets pr ' +
      'JOIN users customer ON customer.id=pr.customer_user_id ' +
      'JOIN users actor ON actor.id=pr.actor_user_id';
    const [count] = await this.db.query<Array<{ total: string }>>(
      'SELECT COUNT(*)::text AS total' + joins + ' WHERE ' + filter,
      [eventId, search],
    );
    const rows = await this.db.query<ResetRow[]>(
      'SELECT pr.*,customer.display_name AS customer_name,' +
        'customer.phone AS customer_phone,actor.display_name AS actor_name' +
        joins +
        ' WHERE ' +
        filter +
        ' ORDER BY pr.created_at DESC,pr.id DESC LIMIT $3 OFFSET $4',
      [eventId, search, limit, offset],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        openId: row.entry_id,
        rewardId: row.reward_id,
        customerUserId: row.customer_user_id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        reason: row.reason,
        before: row.before_snapshot,
        after: row.after_snapshot,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      total: Number(count?.total || 0),
      limit,
      offset,
    };
  }

  async reset(
    actor: AuthUserContext,
    eventId: string,
    customerUserId: string,
    dto: GiftPlayResetDto,
  ): Promise<GiftResetResult> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 3 || reason.length > 500)
      throw new ConflictException('RESET_REASON_REQUIRED');
    return this.db.transaction(async (m) => {
      // Matches GiftOpenService.open locks, preventing a reset/open race.
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'gift.event.open.' + eventId,
      ]);
      const [event] = await m.query<Array<{ id: string }>>(
        'SELECT id FROM gift_event_campaigns WHERE id=$1::uuid FOR UPDATE',
        [eventId],
      );
      if (!event) throw new NotFoundException('EVENT_NOT_FOUND');
      const [entry] = await m.query<EntryToReset[]>(
        'SELECT id,selected_box,created_at FROM gift_event_entries ' +
          'WHERE event_id=$1::uuid AND customer_user_id=$2::uuid AND reset_at IS NULL FOR UPDATE',
        [eventId, customerUserId],
      );
      if (!entry) throw new ConflictException('NO_ACTIVE_PLAY');
      const [reward] = await m.query<RewardToReset[]>(
        'SELECT id,prize_id,status FROM gift_event_rewards WHERE entry_id=$1::uuid FOR UPDATE',
        [entry.id],
      );
      if (!reward) throw new ConflictException('REWARD_NOT_READY');
      const before = {
        customerUserId,
        openId: entry.id,
        boxId: entry.selected_box,
        playedAt: new Date(entry.created_at).toISOString(),
        rewardId: reward.id,
        prizeId: reward.prize_id,
        rewardStatus: reward.status,
      };
      // Never refund stock or budget; redeemed rights and redemption histories remain.
      const nextRewardStatus = reward.status === 'ISSUED' ? 'VOIDED' : reward.status;
      if (reward.status === 'ISSUED')
        await m.query(
          "UPDATE gift_event_rewards SET status='VOIDED',version=version+1 " +
            "WHERE id=$1::uuid AND status='ISSUED'",
          [reward.id],
        );
      await m.query('DELETE FROM gift_event_qr_tokens WHERE reward_id=$1::uuid', [reward.id]);
      await m.query('DELETE FROM gift_event_counter_pins WHERE reward_id=$1::uuid', [reward.id]);
      const [updated] = await m.query<Array<{ reset_at: Date }>>(
        'UPDATE gift_event_entries SET reset_at=clock_timestamp() WHERE id=$1::uuid RETURNING reset_at',
        [entry.id],
      );
      const after = {
        customerUserId,
        openId: entry.id,
        resetAt: new Date(updated.reset_at).toISOString(),
        attemptsRemaining: 1,
        rewardId: reward.id,
        rewardStatus: nextRewardStatus,
        stockOrBudgetRefunded: false,
      };
      const [reset] = await m.query<Array<{ id: string; created_at: Date }>>(
        'INSERT INTO gift_event_play_resets ' +
          '(event_id,entry_id,reward_id,customer_user_id,actor_user_id,' +
          'reason,before_snapshot,after_snapshot) ' +
          'VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::jsonb,$8::jsonb) ' +
          'RETURNING id,created_at',
        [
          eventId,
          entry.id,
          reward.id,
          customerUserId,
          actor.id,
          reason,
          JSON.stringify(before),
          JSON.stringify(after),
        ],
      );
      await m.query(
        'INSERT INTO gift_event_admin_audit ' +
          '(event_id,actor_user_id,action,reason,before_snapshot,after_snapshot) ' +
          "VALUES($1::uuid,$2::uuid,'PLAY_RESET',$3,$4::jsonb,$5::jsonb)",
        [eventId, actor.id, reason, JSON.stringify(before), JSON.stringify(after)],
      );
      return {
        id: reset.id,
        eventId,
        customerUserId,
        openId: entry.id,
        rewardId: reward.id,
        actorUserId: actor.id,
        reason,
        before,
        after,
        createdAt: new Date(reset.created_at).toISOString(),
      };
    });
  }
}
