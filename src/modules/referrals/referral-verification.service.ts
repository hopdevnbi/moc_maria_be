import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';

interface VerifyConfig {
  service: string;
  key: string;
  secret: string;
  identitySecret: string;
}
function configuration(): VerifyConfig | null {
  const service = process.env['REFERRAL_TWILIO_VERIFY_SERVICE_SID'] ?? '';
  const key = process.env['REFERRAL_TWILIO_API_KEY'] ?? '';
  const secret = process.env['REFERRAL_TWILIO_API_SECRET'] ?? '';
  const identitySecret = process.env['REFERRAL_IDENTITY_SECRET'] ?? '';
  return /^VA[0-9a-f]{32}$/i.test(service) &&
    /^SK[0-9a-f]{32}$/i.test(key) &&
    secret.length >= 16 &&
    identitySecret.length >= 32
    ? { service, key, secret, identitySecret }
    : null;
}
export function verificationConfigured(): boolean {
  // Twilio credentials alone must never enable paid SMS, especially on Trial.
  return (
    process.env['REFERRAL_SMS_OTP_ENABLED'] === 'true' &&
    process.env['REFERRAL_TWILIO_TRIAL_MODE'] !== 'true' &&
    configuration() !== null
  );
}
function phoneHash(phone: string, c: VerifyConfig): string {
  return createHmac('sha256', c.identitySecret)
    .update('referral-verified-phone:v1:' + phone)
    .digest('hex');
}
interface VerifyResponse {
  sid?: string;
  to?: string;
  status?: string;
  service_sid?: string;
  channel?: string;
}
// The trusted provider response, never a frontend assertion, is the evidence.
async function verifyCall(
  c: VerifyConfig,
  path: 'Verifications' | 'VerificationCheck',
  fields: Record<string, string>,
): Promise<VerifyResponse> {
  let response: Response;
  try {
    response = await fetch('https://verify.twilio.com/v2/Services/' + c.service + '/' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(c.key + ':' + c.secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
  }
  if (!response.ok) {
    if (path === 'VerificationCheck' && [400, 404].includes(response.status))
      throw new BadRequestException('REFERRAL_OTP_INVALID');
    throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
  }
  return (await response.json()) as VerifyResponse;
}

@Injectable()
export class ReferralVerificationService {
  constructor(private readonly db: DataSource) {}
  private config(): VerifyConfig {
    if (!verificationConfigured())
      throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
    const c = configuration();
    if (!c) throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
    return c;
  }
  private phone(actor: AuthUserContext): string {
    if (!actor.isActive || !actor.phone || !/^\+[1-9][0-9]{7,14}$/.test(actor.phone))
      throw new BadRequestException('REFERRAL_PHONE_REQUIRED');
    return actor.phone;
  }
  async start(actor: AuthUserContext): Promise<{ sent: boolean }> {
    const c = this.config(),
      phone = this.phone(actor),
      hash = phoneHash(phone, c);
    // Reserve the send before calling the paid provider, across all pods.
    const reserved = await this.db.transaction(async (m) => {
      const [ref] = await m.query<{ id: string }[]>(
        `SELECT r.id FROM referrals r CROSS JOIN referral_settings s
        JOIN users u ON u.id=$1 AND u.phone=$2 AND u.is_active
        WHERE r.referred_id=$1 AND r.status='PENDING_VERIFICATION' AND s.id=1 AND s.payout_enabled FOR UPDATE OF r`,
        [actor.id, phone],
      );
      if (!ref) throw new ConflictException('REFERRAL_NOT_PENDING');
      const [row] = await m.query<{ requested_at: Date }[]>(
        `
        INSERT INTO referral_verification_challenges(user_id,phone_hash,requested_at,expires_at,day,sends)
        VALUES($1,$2,date_trunc('milliseconds',clock_timestamp()),clock_timestamp()+interval '10 minutes',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,1)
        ON CONFLICT(user_id) DO UPDATE SET phone_hash=EXCLUDED.phone_hash,provider_sid=NULL,
        requested_at=EXCLUDED.requested_at,expires_at=EXCLUDED.expires_at,day=EXCLUDED.day,
        sends=CASE WHEN referral_verification_challenges.day=EXCLUDED.day THEN referral_verification_challenges.sends+1 ELSE 1 END,attempts=0
        WHERE referral_verification_challenges.requested_at<clock_timestamp()-interval '60 seconds'
        AND (referral_verification_challenges.day<>EXCLUDED.day OR referral_verification_challenges.sends<3)
        RETURNING requested_at
      `,
        [actor.id, hash],
      );
      return row?.requested_at;
    });
    if (!reserved) throw new HttpException('REFERRAL_OTP_RATE_LIMIT', 429);
    const result = await verifyCall(c, 'Verifications', { To: phone, Channel: 'sms' });
    if (
      result.status !== 'pending' ||
      result.to !== phone ||
      result.service_sid !== c.service ||
      result.channel !== 'sms' ||
      !/^VE[0-9a-f]{32}$/i.test(result.sid ?? '')
    )
      throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
    const changed = await this.db.query<{ user_id: string }[]>(
      `WITH changed AS (UPDATE referral_verification_challenges SET provider_sid=$3
      WHERE user_id=$1 AND phone_hash=$2 AND requested_at=$4 RETURNING user_id) SELECT user_id FROM changed`,
      [actor.id, hash, result.sid, reserved],
    );
    if (!changed.length) throw new ConflictException('REFERRAL_OTP_RETRY');
    return { sent: true };
  }
  async confirm(
    actor: AuthUserContext,
    code: string,
  ): Promise<{ rewarded: boolean; status: string }> {
    const c = this.config(),
      phone = this.phone(actor),
      hash = phoneHash(phone, c);
    const [challenge] = await this.db.query<{ provider_sid: string }[]>(
      `
      WITH changed AS (UPDATE referral_verification_challenges v SET attempts=attempts+1
      FROM referral_settings s,referrals r,users u
      WHERE v.user_id=$1 AND v.phone_hash=$2 AND v.provider_sid IS NOT NULL AND v.expires_at>now() AND v.attempts<5
       AND r.referred_id=v.user_id AND r.status='PENDING_VERIFICATION'
       AND u.id=v.user_id AND u.phone=$3 AND u.is_active AND s.id=1 AND s.payout_enabled
      RETURNING v.provider_sid) SELECT provider_sid FROM changed`,
      [actor.id, hash, phone],
    );
    if (!challenge) throw new BadRequestException('REFERRAL_OTP_INVALID');
    const result = await verifyCall(c, 'VerificationCheck', {
      VerificationSid: challenge.provider_sid,
      Code: code,
    });
    if (
      result.status !== 'approved' ||
      result.sid !== challenge.provider_sid ||
      result.to !== phone ||
      result.service_sid !== c.service ||
      result.channel !== 'sms'
    )
      throw new BadRequestException('REFERRAL_OTP_INVALID');
    return this.db.transaction(async (m) => {
      const [ref] = await m.query<
        { id: string; referrer_id: string; reward_coins: number; status: string }[]
      >(
        `
        SELECT r.id,r.referrer_id,r.reward_coins,r.status FROM referrals r
        JOIN users u ON u.id=r.referred_id AND u.phone=$2 AND u.is_active
        JOIN users a ON a.id=r.referrer_id AND a.is_active
        CROSS JOIN referral_settings s
        WHERE r.referred_id=$1 AND s.id=1 AND s.payout_enabled
        FOR UPDATE OF r,u,a`,
        [actor.id, phone],
      );
      if (!ref) throw new ConflictException('REFERRAL_NOT_PENDING');
      if (ref.status === 'REWARDED') return { rewarded: true, status: 'REWARDED' };
      if (ref.status !== 'PENDING_VERIFICATION') return { rewarded: false, status: ref.status };
      const [prior] = await m.query<{ seen: boolean }[]>(
        'SELECT EXISTS(SELECT 1 FROM referral_phone_claims WHERE phone_hash=$1 AND referral_id<>$2) AS seen',
        [hash, ref.id],
      );
      if (prior.seen)
        await m.query(
          "UPDATE referrals SET risk_score=LEAST(100,risk_score+40),risk_flags=risk_flags||jsonb_build_array('VERIFIED_PHONE_PREVIOUSLY_USED'::text) WHERE id=$1 AND NOT risk_flags ? 'VERIFIED_PHONE_PREVIOUSLY_USED'",
          [ref.id],
        );
      const [proof] = await m.query<{ referral_id: string }[]>(
        `
        INSERT INTO referral_phone_claims(referral_id,phone_hash) VALUES($1,$2)
        ON CONFLICT DO NOTHING RETURNING referral_id`,
        [ref.id, hash],
      );
      if (!proof) {
        throw new ConflictException('REFERRAL_PROOF_ALREADY_RECORDED');
      }
      // No risk_score or device/IP predicate is allowed in this path.
      await m.query(
        'INSERT INTO referral_coin_ledger(referral_id,user_id,amount) VALUES($1,$2,$3)',
        [ref.id, ref.referrer_id, ref.reward_coins],
      );
      await m.query(
        `INSERT INTO staff_coin_wallets(user_id,balance,total_earned) VALUES($1,$2,$2)
        ON CONFLICT(user_id) DO UPDATE SET balance=staff_coin_wallets.balance+EXCLUDED.balance,
        total_earned=staff_coin_wallets.total_earned+EXCLUDED.total_earned,updated_at=now()`,
        [ref.referrer_id, ref.reward_coins],
      );
      await m.query("UPDATE referrals SET status='REWARDED' WHERE id=$1", [ref.id]);
      await m.query('DELETE FROM referral_verification_challenges WHERE user_id=$1', [actor.id]);
      await m.query(
        "INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('REFERRAL_REWARDED',$1,jsonb_build_object('referralId',$2::text,'coins',$3::int))",
        [actor.id, ref.id, ref.reward_coins],
      );
      return { rewarded: true, status: 'REWARDED' };
    });
  }
}
