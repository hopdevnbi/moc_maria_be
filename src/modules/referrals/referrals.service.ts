import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { verificationConfigured } from './referral-verification.service';

interface ReferralRow {
  id: string;
  status: string;
  rewardCoins: number;
  createdAt: Date;
}
interface AdminReferralRow extends ReferralRow {
  referrerName: string;
  referredName: string;
  riskScore: number;
  riskFlags: string[];
  reviewedAt: Date | null;
}
export interface ReferralSettings {
  enabled: boolean;
  rewardCoins: number;
  payoutEnabled: boolean;
}
export function assertReferralAdmin(actor: AuthUserContext): void {
  if (
    !actor.isActive ||
    !actor.roles.includes('SUPER_ADMIN') ||
    !actor.permissions.includes('admin.portal')
  )
    throw new ForbiddenException('REFERRAL_FORBIDDEN');
}

@Injectable()
export class ReferralsService {
  constructor(private readonly db: DataSource) {}
  async settings(
    actor: AuthUserContext,
  ): Promise<ReferralSettings & { verificationConfigured: boolean }> {
    assertReferralAdmin(actor);
    const [row] = await this.db.query<ReferralSettings[]>(
      'SELECT enabled,reward_coins AS "rewardCoins",payout_enabled AS "payoutEnabled" FROM referral_settings WHERE id=1',
    );
    return { ...row, verificationConfigured: verificationConfigured() };
  }
  async saveSettings(actor: AuthUserContext, input: ReferralSettings): Promise<ReferralSettings> {
    assertReferralAdmin(actor);
    if (input.payoutEnabled && !verificationConfigured())
      throw new ConflictException('REFERRAL_OTP_UNAVAILABLE');
    return this.db.transaction(async (m) => {
      const [row] = await m.query<ReferralSettings[]>(
        'WITH changed AS (UPDATE referral_settings SET enabled=$1,reward_coins=$2,payout_enabled=$3 WHERE id=1 RETURNING enabled,reward_coins AS "rewardCoins",payout_enabled AS "payoutEnabled") SELECT * FROM changed',
        [input.enabled, input.rewardCoins, input.payoutEnabled],
      );
      await m.query(
        "INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('REFERRAL_SETTINGS_SAVED',$1,$2::jsonb)",
        [actor.id, JSON.stringify(row)],
      );
      return row;
    });
  }
  async mine(actor: AuthUserContext): Promise<{
    code: string;
    enabled: boolean;
    rewardCoins: number;
    registered: number;
    rewarded: number;
    coins: number;
    verificationAvailable: boolean;
    verificationStatus: string | null;
    hasPhone: boolean;
  }> {
    return this.db.transaction(async (m) => {
      await m.query(
        'INSERT INTO referral_codes(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
        [actor.id],
      );
      const [settings] = await m.query<
        { code: string; enabled: boolean; rewardCoins: number; payoutEnabled: boolean }[]
      >(
        `
        SELECT c.code,s.enabled,s.reward_coins AS "rewardCoins",s.payout_enabled AS "payoutEnabled" FROM referral_codes c
        CROSS JOIN referral_settings s WHERE c.user_id=$1 AND s.id=1
      `,
        [actor.id],
      );
      const [stats] = await m.query<{ registered: number; rewarded: number; coins: number }[]>(
        `
        SELECT count(*)::int AS registered,count(*) FILTER(WHERE status='REWARDED')::int AS rewarded,
         COALESCE(sum(reward_coins) FILTER(WHERE status='REWARDED'),0)::int AS coins
        FROM referrals WHERE referrer_id=$1
      `,
        [actor.id],
      );
      const [own] = await m.query<{ status: string }[]>(
        'SELECT status FROM referrals WHERE referred_id=$1',
        [actor.id],
      );
      return {
        code: settings.code,
        enabled: settings.enabled,
        rewardCoins: settings.rewardCoins,
        ...stats,
        verificationAvailable: settings.payoutEnabled && verificationConfigured(),
        verificationStatus: own?.status ?? null,
        hasPhone: !!actor.phone,
      };
    });
  }
  async list(
    actor: AuthUserContext,
    page: number,
  ): Promise<{ items: AdminReferralRow[]; hasMore: boolean }> {
    assertReferralAdmin(actor);
    const rows = await this.db.query<AdminReferralRow[]>(
      `
      SELECT r.id,r.status,r.reward_coins AS "rewardCoins",r.created_at AS "createdAt",r.risk_score AS "riskScore",
      r.risk_flags AS "riskFlags",r.reviewed_at AS "reviewedAt",a.display_name AS "referrerName",b.display_name AS "referredName"
      FROM referrals r JOIN users a ON a.id=r.referrer_id JOIN users b ON b.id=r.referred_id
      ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET $1
    `,
      [(page - 1) * 50],
    );
    return { items: rows.slice(0, 50), hasMore: rows.length > 50 };
  }
  async review(actor: AuthUserContext, id: string): Promise<{ reviewed: boolean }> {
    assertReferralAdmin(actor);
    return this.db.transaction(async (m) => {
      const [row] = await m.query<{ id: string }[]>(
        `
        WITH changed AS (UPDATE referrals SET reviewed_at=now(),reviewed_by=$2 WHERE id=$1 AND referrer_id<>$2
        RETURNING id) SELECT id FROM changed
      `,
        [id, actor.id],
      );
      if (!row) throw new NotFoundException('REFERRAL_NOT_FOUND');
      await m.query(
        "INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('REFERRAL_RISK_REVIEWED',$1,jsonb_build_object('referralId',$2::text))",
        [actor.id, id],
      );
      return { reviewed: true };
    });
  }
}
