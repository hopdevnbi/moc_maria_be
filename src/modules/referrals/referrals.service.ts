import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { verificationConfigured } from './referral-verification.service';
import { COMMUNITY_KEY, normalizeCommunityUrl } from './referral-community';

interface ReferralRow {
  id: string;
  status: string;
  rewardCoins: number;
  createdAt: Date;
}
interface MemberReferralRow extends ReferralRow {
  awardedAt: Date | null;
  earnedCoins: number;
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
  async community(actor: AuthUserContext): Promise<{ url: string | null }> {
    if (!actor.isActive) throw new ForbiddenException('REFERRAL_FORBIDDEN');
    const [row] = await this.db.query<{ url: unknown }[]>(
      "SELECT value->>'url' AS url FROM app_metadata WHERE key=$1",
      [COMMUNITY_KEY],
    );
    return { url: normalizeCommunityUrl(row?.url) };
  }
  async saveCommunity(actor: AuthUserContext, input: string): Promise<{ url: string | null }> {
    assertReferralAdmin(actor);
    const url = normalizeCommunityUrl(input);
    if (input.trim() && !url) throw new BadRequestException('REFERRAL_COMMUNITY_URL_INVALID');
    await this.db.transaction(async (m) => {
      await m.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,jsonb_build_object('url',$2::text))
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
        [COMMUNITY_KEY, url],
      );
      await m.query(
        "INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('REFERRAL_COMMUNITY_SAVED',$1,jsonb_build_object('enabled',$2::boolean))",
        [actor.id, !!url],
      );
    });
    return { url };
  }
  // Only the owner's records and committed ledger amounts are returned.
  // Do not expose referred identities, contact details, risk or device signals.
  async history(
    actor: AuthUserContext,
    page: number,
  ): Promise<{ items: MemberReferralRow[]; hasMore: boolean }> {
    if (!actor.isActive) throw new ForbiddenException('REFERRAL_FORBIDDEN');
    const rows = await this.db.query<MemberReferralRow[]>(
      `
      SELECT r.id,r.status,r.reward_coins AS "rewardCoins",r.created_at AS "createdAt",
        CASE WHEN r.status='REWARDED' THEN l.created_at ELSE NULL END AS "awardedAt",
        CASE WHEN r.status='REWARDED' THEN COALESCE(l.amount,0) ELSE 0 END AS "earnedCoins"
      FROM referrals r LEFT JOIN referral_coin_ledger l ON l.referral_id=r.id AND l.user_id=r.referrer_id
      WHERE r.referrer_id=$1
      ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET $2
    `,
      [actor.id, (page - 1) * 20],
    );
    return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
  }
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
    latestReward: { id: string; amount: number; awardedAt: Date } | null;
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
         COALESCE(sum(l.amount) FILTER(WHERE r.status='REWARDED'),0)::int AS coins
        FROM referrals r LEFT JOIN referral_coin_ledger l ON l.referral_id=r.id AND l.user_id=r.referrer_id WHERE r.referrer_id=$1
      `,
        [actor.id],
      );
      const [own] = await m.query<{ status: string }[]>(
        'SELECT status FROM referrals WHERE referred_id=$1',
        [actor.id],
      );
      const [latestReward] = await m.query<{ id: string; amount: number; awardedAt: Date }[]>(
        `
        SELECT l.referral_id AS id,l.amount,l.created_at AS "awardedAt" FROM referral_coin_ledger l
        JOIN referrals r ON r.id=l.referral_id AND r.referrer_id=l.user_id AND r.status='REWARDED'
        WHERE l.user_id=$1 ORDER BY l.created_at DESC,l.referral_id DESC LIMIT 1
      `,
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
        latestReward: latestReward ?? null,
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
