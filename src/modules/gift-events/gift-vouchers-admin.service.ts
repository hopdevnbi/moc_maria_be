import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import type { GiftVoucherFilterDto, VoidGiftVoucherDto } from './gift-vouchers-admin.dto';

@Injectable()
export class GiftVouchersAdminService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}

  async list(
    actor: AuthUserContext,
    eventId: string,
    filter: GiftVoucherFilterDto,
  ): Promise<unknown[]> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    if (filter.status && !['ISSUED', 'REDEEMED', 'EXPIRED', 'VOIDED'].includes(filter.status))
      throw new BadRequestException('INVALID_VOUCHER_STATUS');
    const from = filter.from ? Date.parse(filter.from) : NaN;
    const to = filter.to ? Date.parse(filter.to) : NaN;
    if (
      (filter.from && !Number.isFinite(from)) ||
      (filter.to && !Number.isFinite(to)) ||
      (Number.isFinite(from) && Number.isFinite(to) && from > to)
    )
      throw new BadRequestException('INVALID_DATE_RANGE');
    await this.events.detail(actor, eventId);
    return this.db.query(
      `SELECT r.id,r.event_id AS "eventId",r.customer_user_id AS "customerId",
        r.prize_id AS "prizeId",r.reward_snapshot->>'name' AS "name",
        r.reward_snapshot->>'kind' AS "kind",
        CASE WHEN r.status='ISSUED' AND r.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE r.status END AS status,r.version,
        r.issued_at AS "issuedAt",r.expires_at AS "expiresAt",
        r.redeemed_at AS "redeemedAt",r.redeemed_branch_id AS "redeemedBranchId"
       FROM gift_event_rewards r
       WHERE r.event_id=$1::uuid
         AND ($2::text IS NULL OR CASE WHEN r.status='ISSUED' AND r.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE r.status END=$2)
         AND ($3::timestamptz IS NULL OR r.issued_at >= $3)
         AND ($4::timestamptz IS NULL OR r.issued_at <= $4)
         AND ($5::uuid IS NULL OR r.customer_user_id=$5)
       ORDER BY r.issued_at DESC,r.id DESC LIMIT $6`,
      [
        eventId,
        filter.status || null,
        filter.from || null,
        filter.to || null,
        filter.customerId || null,
        filter.limit || 50,
      ],
    );
  }

  async void(
    actor: AuthUserContext,
    eventId: string,
    rewardId: string,
    dto: VoidGiftVoucherDto,
  ): Promise<{ status: 'VOIDED'; id: string }> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    return this.db.transaction(async (m) => {
      const [row] = await m.query<Array<{ id: string; version: number; status: string }>>(
        `SELECT id,version,status FROM gift_event_rewards WHERE id=$1::uuid AND event_id=$2::uuid FOR UPDATE`,
        [rewardId, eventId],
      );
      if (!row) throw new NotFoundException('VOUCHER_NOT_FOUND');
      if (Number(row.version) !== dto.expectedVersion)
        throw new ConflictException('VOUCHER_CHANGED');
      if (row.status !== 'ISSUED') throw new ConflictException('VOUCHER_NOT_REVOCABLE');
      await m.query(
        `UPDATE gift_event_rewards SET status='VOIDED',version=version+1 WHERE id=$1::uuid`,
        [rewardId],
      );
      await m.query(
        `INSERT INTO gift_event_redemption_history (reward_id,actor_user_id,action,reason)
         VALUES ($1::uuid,$2::uuid,'REVOKE',$3)`,
        [rewardId, actor.id, dto.reason.trim()],
      );
      await m.query(
        `INSERT INTO gift_event_admin_audit(event_id,actor_user_id,action,reason,before_snapshot,after_snapshot)
         VALUES ($1::uuid,$2::uuid,'VOUCHER_VOIDED',$3,$4::jsonb,$5::jsonb)`,
        [
          eventId,
          actor.id,
          dto.reason.trim(),
          JSON.stringify({ rewardId, status: row.status, version: row.version }),
          JSON.stringify({ rewardId, status: 'VOIDED', version: Number(row.version) + 1 }),
        ],
      );
      return { status: 'VOIDED' as const, id: rewardId };
    });
  }
}
