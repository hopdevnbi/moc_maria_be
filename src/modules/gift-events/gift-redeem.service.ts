import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { GiftEventsService } from './gift-events.service';
import type {
  GiftCounterGrantDto,
  RedeemGiftDto,
  RedeemGiftResult,
  VerifyGiftDto,
  VerifyGiftResult,
} from './gift-redeem.dto';

type Reward = {
  id: string;
  event_id: string;
  reward_snapshot: { name: string; kind: string; allowedBranchIds?: string[] };
  status: 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  expires_at: Date;
  redeemed_at: Date | null;
  redeemed_by: string | null;
  redeemed_branch_id: string | null;
};
type QrRow = { reward_id: string; token_hash: string; expires_at: Date };
const digest = (token: string): string => createHash('sha256').update(token).digest('hex');
const VALID_ROLES = ['RECEPTIONIST', 'BRANCH_MANAGER', 'ADMIN'] as const;

@Injectable()
export class GiftRedeemService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}
  async branches(actor: AuthUserContext): Promise<Array<{ id: string; name: string }>> {
    this.events.requireEnabled();
    if (!actor.isActive || actor.mustChangePassword)
      throw new ForbiddenException('COUNTER_ACCESS_DENIED');
    if (actor.roles.includes('SUPER_ADMIN') && actor.permissions.includes('admin.portal'))
      return this.db.query<Array<{ id: string; name: string }>>(
        'SELECT id,name FROM branches WHERE is_active ORDER BY name',
      );
    if (
      !actor.roles.some((r) => VALID_ROLES.includes(r as (typeof VALID_ROLES)[number])) ||
      !actor.permissions.includes('staff.portal')
    )
      throw new ForbiddenException('COUNTER_ACCESS_DENIED');
    return this.db.query<Array<{ id: string; name: string }>>(
      `SELECT b.id,b.name FROM gift_event_counter_access a
      JOIN branches b ON b.id=a.branch_id AND b.is_active
      JOIN staff_profiles sp ON sp.user_id=a.user_id AND sp.is_active
      WHERE a.user_id=$1::uuid ORDER BY b.name`,
      [actor.id],
    );
  }
  private async canUseCounter(
    m: EntityManager,
    actor: AuthUserContext,
    branchId: string,
  ): Promise<void> {
    if (!actor.isActive || actor.mustChangePassword)
      throw new ForbiddenException('COUNTER_ACCESS_DENIED');
    const [branch] = await m.query<Array<{ id: string }>>(
      'SELECT id FROM branches WHERE id=$1::uuid AND is_active',
      [branchId],
    );
    if (!branch) throw new ForbiddenException('BRANCH_NOT_AVAILABLE');
    if (actor.roles.includes('SUPER_ADMIN') && actor.permissions.includes('admin.portal')) return;
    if (
      !actor.roles.some((r) => VALID_ROLES.includes(r as (typeof VALID_ROLES)[number])) ||
      !actor.permissions.includes('staff.portal')
    )
      throw new ForbiddenException('COUNTER_ACCESS_DENIED');
    // A role alone never gives cross-branch access; an explicit Super Admin grant is mandatory.
    const [grant] = await m.query<Array<{ user_id: string }>>(
      `SELECT a.user_id FROM gift_event_counter_access a
      JOIN staff_profiles sp ON sp.user_id=a.user_id AND sp.is_active
      JOIN users u ON u.id=a.user_id AND u.is_active
      WHERE a.user_id=$1::uuid AND a.branch_id=$2::uuid`,
      [actor.id, branchId],
    );
    if (!grant) throw new ForbiddenException('COUNTER_ACCESS_DENIED');
  }
  private assertToken(token: string): void {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BadRequestException('INVALID_QR_TOKEN');
  }
  private verifyReward(reward: Reward, branchId: string, token: QrRow, now: Date): void {
    const allowed = reward.reward_snapshot.allowedBranchIds || [];
    if (!allowed.includes(branchId)) throw new ForbiddenException('BRANCH_NOT_ALLOWED');
    if (reward.status !== 'ISSUED') throw new ConflictException('REWARD_NOT_REDEEMABLE');
    if (new Date(reward.expires_at) <= now) throw new ConflictException('REWARD_EXPIRED');
    if (new Date(token.expires_at) <= now) throw new ConflictException('QR_EXPIRED');
  }
  async verify(actor: AuthUserContext, dto: VerifyGiftDto): Promise<VerifyGiftResult> {
    this.events.requireEnabled();
    this.assertToken(dto.token);
    await this.canUseCounter(this.db.manager, actor, dto.branchId);
    const [info] = await this.db.query<Array<QrRow & Reward>>(
      `SELECT t.reward_id,t.token_hash,t.expires_at AS token_expires_at,
      r.id,r.event_id,r.reward_snapshot,r.status,r.expires_at,r.redeemed_at,r.redeemed_by,r.redeemed_branch_id
      FROM gift_event_qr_tokens t JOIN gift_event_rewards r ON r.id=t.reward_id
      WHERE t.token_hash=$1`,
      [digest(dto.token)],
    );
    if (!info) throw new NotFoundException('QR_NOT_FOUND');
    const token = {
      reward_id: info.reward_id,
      token_hash: info.token_hash,
      expires_at: (info as typeof info & { token_expires_at: Date }).token_expires_at,
    };
    this.verifyReward(info, dto.branchId, token, new Date());
    // Verification is only informational; never marks a gift redeemed.
    return {
      rewardId: info.id,
      eventId: info.event_id,
      name: info.reward_snapshot.name,
      kind: info.reward_snapshot.kind,
      expiresAt: new Date(info.expires_at).toISOString(),
      branchId: dto.branchId,
      status: 'ISSUED',
    };
  }
  async redeem(actor: AuthUserContext, dto: RedeemGiftDto): Promise<RedeemGiftResult> {
    this.events.requireEnabled();
    this.assertToken(dto.token);
    return this.db.transaction(async (m) => {
      await this.canUseCounter(m, actor, dto.branchId);
      const hash = digest(dto.token);
      const [matched] = await m.query<Array<{ reward_id: string }>>(
        'SELECT reward_id FROM gift_event_qr_tokens WHERE token_hash=$1',
        [hash],
      );
      if (!matched) throw new NotFoundException('QR_NOT_FOUND');
      // Same lock order as customer QR mint: reward -> token.
      const [reward] = await m.query<Reward[]>(
        `SELECT id,event_id,reward_snapshot,status,expires_at,
        redeemed_at,redeemed_by,redeemed_branch_id FROM gift_event_rewards WHERE id=$1::uuid FOR UPDATE`,
        [matched.reward_id],
      );
      if (!reward) throw new NotFoundException('REWARD_NOT_FOUND');
      if (!(reward.reward_snapshot.allowedBranchIds || []).includes(dto.branchId))
        throw new ForbiddenException('BRANCH_NOT_ALLOWED');
      const [token] = await m.query<QrRow[]>(
        `SELECT reward_id,token_hash,expires_at
        FROM gift_event_qr_tokens WHERE reward_id=$1::uuid FOR UPDATE`,
        [matched.reward_id],
      );
      if (!token || token.token_hash !== hash) throw new ConflictException('QR_REPLACED');
      if (reward.status === 'REDEEMED') {
        const [history] = await m.query<Array<{ id: string }>>(
          `SELECT id FROM gift_event_redemption_history
          WHERE reward_id=$1::uuid AND actor_user_id=$2::uuid AND branch_id=$3::uuid
            AND action='REDEEM' AND metadata->>'idempotencyKey'=$4 LIMIT 1`,
          [reward.id, actor.id, dto.branchId, dto.idempotencyKey],
        );
        if (history)
          return {
            rewardId: reward.id,
            eventId: reward.event_id,
            status: 'REDEEMED',
            branchId: dto.branchId,
            redeemedAt: new Date(reward.redeemed_at!).toISOString(),
            alreadyProcessed: true,
          };
        throw new ConflictException('ALREADY_REDEEMED');
      }
      const now = new Date();
      this.verifyReward(reward, dto.branchId, token, now);
      const [updated] = await m.query<Array<{ redeemed_at: Date }>>(
        `UPDATE gift_event_rewards
        SET status='REDEEMED',redeemed_at=clock_timestamp(),redeemed_by=$2::uuid,
          redeemed_branch_id=$3::uuid,version=version+1
        WHERE id=$1::uuid AND status='ISSUED' AND expires_at>clock_timestamp()
        RETURNING redeemed_at`,
        [reward.id, actor.id, dto.branchId],
      );
      if (!updated) throw new ConflictException('REWARD_EXPIRED_OR_CHANGED');
      await m.query(
        `INSERT INTO gift_event_redemption_history
        (reward_id,actor_user_id,branch_id,action,reason,metadata)
        VALUES($1::uuid,$2::uuid,$3::uuid,'REDEEM','Đối chiếu tại quầy',$4::jsonb)`,
        [
          reward.id,
          actor.id,
          dto.branchId,
          JSON.stringify({ idempotencyKey: dto.idempotencyKey, verifiedOnline: true }),
        ],
      );
      return {
        rewardId: reward.id,
        eventId: reward.event_id,
        status: 'REDEEMED',
        branchId: dto.branchId,
        redeemedAt: new Date(updated.redeemed_at).toISOString(),
        alreadyProcessed: false,
      };
    });
  }
  async grant(actor: AuthUserContext, dto: GiftCounterGrantDto): Promise<void> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    await this.db.transaction(async (m) => {
      const [target] = await m.query<Array<{ id: string }>>(
        `SELECT u.id FROM users u
        JOIN staff_profiles sp ON sp.user_id=u.id AND sp.is_active
        JOIN user_roles ur ON ur.user_id=u.id
        JOIN roles r ON r.id=ur.role_id AND r.name=ANY($2::varchar[])
        WHERE u.id=$1::uuid AND u.is_active LIMIT 1`,
        [dto.userId, VALID_ROLES],
      );
      if (!target) throw new BadRequestException('Nhân viên chưa đủ điều kiện nhận quyền quầy.');
      const [branch] = await m.query<Array<{ id: string }>>(
        'SELECT id FROM branches WHERE id=$1::uuid AND is_active',
        [dto.branchId],
      );
      if (!branch) throw new BadRequestException('Cơ sở không hoạt động.');
      await m.query(
        `INSERT INTO gift_event_counter_access(user_id,branch_id,granted_by)
        VALUES($1::uuid,$2::uuid,$3::uuid)
        ON CONFLICT(user_id,branch_id) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=clock_timestamp()`,
        [dto.userId, dto.branchId, actor.id],
      );
      await m.query(
        `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata)
        VALUES('GIFT_COUNTER_ACCESS_GRANTED',$1::uuid,$2::uuid,$3::jsonb)`,
        [actor.id, dto.userId, JSON.stringify({ branchId: dto.branchId, reason: dto.reason })],
      );
    });
  }
  async revoke(actor: AuthUserContext, dto: GiftCounterGrantDto): Promise<void> {
    this.events.requireAdmin(actor);
    this.events.requireEnabled();
    await this.db.transaction(async (m) => {
      await m.query(
        'DELETE FROM gift_event_counter_access WHERE user_id=$1::uuid AND branch_id=$2::uuid',
        [dto.userId, dto.branchId],
      );
      await m.query(
        `INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata)
        VALUES('GIFT_COUNTER_ACCESS_REVOKED',$1::uuid,$2::uuid,$3::jsonb)`,
        [actor.id, dto.userId, JSON.stringify({ branchId: dto.branchId, reason: dto.reason })],
      );
    });
  }
}
