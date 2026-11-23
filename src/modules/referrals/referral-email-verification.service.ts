import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes, randomInt, timingSafeEqual, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { MOC_MARIA_EMAIL_FROM } from '../../shared/email/moc-maria-email';

const languages = ['vi', 'en', 'ko', 'ja', 'zh-CN', 'ru'] as const;
export type ReferralEmailLocale = (typeof languages)[number];
const subject: Record<ReferralEmailLocale, string> = {
  vi: 'Mã xác minh giới thiệu Mộc Maria',
  en: 'Mộc Maria referral verification code',
  ko: 'Mộc Maria 추천 인증 코드',
  ja: 'Mộc Maria 紹介確認コード',
  'zh-CN': 'Mộc Maria 邀请验证码',
  ru: 'Код подтверждения приглашения Mộc Maria',
};
const message: Record<ReferralEmailLocale, (code: string) => string> = {
  vi: (code) =>
    `Mã xác minh của bạn: ${code}. Mã hết hạn sau 10 phút. Không chia sẻ mã với bất kỳ ai.`,
  en: (code) => `Your verification code: ${code}. Expires in 10 minutes. Never share this code.`,
  ko: (code) => `인증 코드: ${code}. 10분 후 만료됩니다. 누구와도 공유하지 마세요.`,
  ja: (code) => `確認コード: ${code}。10分で期限切れになります。誰にも共有しないでください。`,
  'zh-CN': (code) => `验证码：${code}。10 分钟后失效。请勿与任何人分享。`,
  ru: (code) => `Код подтверждения: ${code}. Срок действия 10 минут. Никому не сообщайте код.`,
};

export function emailVerificationConfigured(): boolean {
  return (
    process.env['REFERRAL_EMAIL_OTP_ENABLED'] === 'true' &&
    (process.env['REFERRAL_IDENTITY_SECRET'] ?? '').length >= 32 &&
    !!process.env['QUEUE_SERVICE_URL']?.trim() &&
    !!process.env['QUEUE_API_KEY']?.trim()
  );
}

function hash(kind: string, value: string): string {
  const secret = process.env['REFERRAL_IDENTITY_SECRET'] ?? '';
  if (secret.length < 32) throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
  return createHmac('sha256', secret)
    .update(kind + ':' + value)
    .digest('hex');
}

function emailOf(actor: AuthUserContext): string {
  const value = actor.email?.trim().toLowerCase() ?? '';
  if (!actor.isActive || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new BadRequestException('REFERRAL_EMAIL_REQUIRED');
  return value;
}

/** The Queue must erase the OTP payload for this exact purpose on both completion and failure. */
async function enqueueEmail(
  email: string,
  code: string,
  locale: ReferralEmailLocale,
): Promise<void> {
  const base = process.env['QUEUE_SERVICE_URL']?.trim();
  const key = process.env['QUEUE_API_KEY']?.trim();
  if (!base || !key) throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
  const text = message[locale](code);
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;background:#f3f7f1;padding:24px"><div style="max-width:480px;margin:auto;background:white;padding:28px;border-radius:16px"><h1 style="color:#225b3c">Mộc Maria</h1><p>${text.replace(code, '<strong style="font-size:30px;letter-spacing:5px">' + code + '</strong>')}</p></div></body></html>`;
  let response: Response;
  try {
    response = await fetch(base.replace(/\/$/, '') + '/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify({
        queue: 'email',
        name: 'email.send',
        data: {
          from: MOC_MARIA_EMAIL_FROM,
          to: email,
          subject: subject[locale],
          text,
          html,
          purpose: 'moc-maria-referral-email-otp',
          correlationId: randomUUID(),
        },
        options: { attempts: 1, jobId: 'referral-email-' + randomUUID() },
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
  } catch {
    throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
  }
  if (response.status !== 202) throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
}

@Injectable()
export class ReferralEmailVerificationService {
  constructor(private readonly db: DataSource) {}

  async start(
    actor: AuthUserContext,
    locale: ReferralEmailLocale = 'vi',
  ): Promise<{ sent: boolean; channel: 'email' }> {
    if (!emailVerificationConfigured())
      throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
    const email = emailOf(actor);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const nonce = randomBytes(16).toString('hex');
    const emailHash = hash('referral-email:v1', email);
    const codeHash = hash(
      'referral-email-code:v1',
      actor.id + ':' + email + ':' + nonce + ':' + code,
    );
    const requestedAt = await this.db.transaction(async (m) => {
      const [ref] = await m.query<{ id: string }[]>(
        `SELECT r.id FROM referrals r CROSS JOIN referral_settings s
          JOIN users u ON u.id=$1 AND lower(u.email)=$2 AND u.is_active
          WHERE r.referred_id=$1 AND r.status='PENDING_VERIFICATION' AND s.id=1 AND s.payout_enabled FOR UPDATE OF r`,
        [actor.id, email],
      );
      if (!ref) throw new ConflictException('REFERRAL_NOT_PENDING');
      const [row] = await m.query<{ requested_at: Date }[]>(
        `INSERT INTO referral_email_challenges(user_id,email_hash,code_hash,nonce,requested_at,expires_at,day,sends,attempts,delivered)
          VALUES($1,$2,$3,$4,date_trunc('milliseconds',clock_timestamp()),clock_timestamp()+interval '10 minutes',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,1,0,false)
          ON CONFLICT(user_id) DO UPDATE SET email_hash=EXCLUDED.email_hash,code_hash=EXCLUDED.code_hash,nonce=EXCLUDED.nonce,
           requested_at=EXCLUDED.requested_at,expires_at=EXCLUDED.expires_at,day=EXCLUDED.day,
           sends=CASE WHEN referral_email_challenges.day=EXCLUDED.day THEN referral_email_challenges.sends+1 ELSE 1 END,
           attempts=0,delivered=false
          WHERE referral_email_challenges.requested_at<clock_timestamp()-interval '60 seconds'
           AND (referral_email_challenges.day<>EXCLUDED.day OR referral_email_challenges.sends<3)
          RETURNING requested_at`,
        [actor.id, emailHash, codeHash, nonce],
      );
      return row?.requested_at;
    });
    if (!requestedAt) throw new HttpException('REFERRAL_OTP_RATE_LIMIT', 429);
    await enqueueEmail(email, code, languages.includes(locale) ? locale : 'vi');
    const changed = await this.db.query<{ user_id: string }[]>(
      `UPDATE referral_email_challenges SET delivered=true
        WHERE user_id=$1 AND email_hash=$2 AND nonce=$3 AND requested_at=$4 RETURNING user_id`,
      [actor.id, emailHash, nonce, requestedAt],
    );
    if (!changed.length) throw new ConflictException('REFERRAL_OTP_RETRY');
    return { sent: true, channel: 'email' };
  }

  async confirm(
    actor: AuthUserContext,
    code: string,
  ): Promise<{ rewarded: boolean; status: string }> {
    if (!emailVerificationConfigured())
      throw new ServiceUnavailableException('REFERRAL_OTP_UNAVAILABLE');
    const email = emailOf(actor);
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('REFERRAL_OTP_INVALID');
    const emailHash = hash('referral-email:v1', email);
    const outcome = await this.db.transaction(async (m) => {
      const [challenge] = await m.query<
        {
          code_hash: string;
          nonce: string;
          expires_at: Date;
          attempts: number;
          delivered: boolean;
        }[]
      >(
        'SELECT code_hash,nonce,expires_at,attempts,delivered FROM referral_email_challenges WHERE user_id=$1 AND email_hash=$2 FOR UPDATE',
        [actor.id, emailHash],
      );
      if (
        !challenge ||
        !challenge.delivered ||
        challenge.attempts >= 5 ||
        new Date(challenge.expires_at).getTime() <= Date.now()
      )
        return { invalid: true } as const;
      const actual = hash(
        'referral-email-code:v1',
        actor.id + ':' + email + ':' + challenge.nonce + ':' + code,
      );
      if (!timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(challenge.code_hash, 'hex'))) {
        await m.query('UPDATE referral_email_challenges SET attempts=attempts+1 WHERE user_id=$1', [
          actor.id,
        ]);
        return { invalid: true } as const;
      }
      const [ref] = await m.query<
        { id: string; referrer_id: string; reward_coins: number; status: string }[]
      >(
        `SELECT r.id,r.referrer_id,r.reward_coins,r.status FROM referrals r
         JOIN users u ON u.id=r.referred_id AND lower(u.email)=$2 AND u.is_active
         JOIN users a ON a.id=r.referrer_id AND a.is_active CROSS JOIN referral_settings s
         WHERE r.referred_id=$1 AND s.id=1 AND s.payout_enabled FOR UPDATE OF r,u,a`,
        [actor.id, email],
      );
      if (!ref) return { invalid: true } as const;
      if (ref.status !== 'PENDING_VERIFICATION') return { invalid: true } as const;
      const [prior] = await m.query<{ seen: boolean }[]>(
        'SELECT EXISTS(SELECT 1 FROM referral_email_claims WHERE email_hash=$1 AND referral_id<>$2) AS seen',
        [emailHash, ref.id],
      );
      if (prior.seen) {
        await m.query(
          `UPDATE referrals SET risk_score=LEAST(100,risk_score+40),
             risk_flags=risk_flags||jsonb_build_array('VERIFIED_EMAIL_PREVIOUSLY_USED'::text)
            WHERE id=$1 AND NOT risk_flags ? 'VERIFIED_EMAIL_PREVIOUSLY_USED'`,
          [ref.id],
        );
      }
      await m.query('INSERT INTO referral_email_claims(referral_id,email_hash) VALUES($1,$2)', [
        ref.id,
        emailHash,
      ]);
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
      await m.query('DELETE FROM referral_email_challenges WHERE user_id=$1', [actor.id]);
      await m.query('DELETE FROM referral_verification_challenges WHERE user_id=$1', [actor.id]);
      await m.query(
        "INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES('REFERRAL_REWARDED',$1,jsonb_build_object('referralId',$2::text,'coins',$3::int,'channel','email'))",
        [actor.id, ref.id, ref.reward_coins],
      );
      return { invalid: false, rewarded: true, status: 'REWARDED' } as const;
    });
    if (outcome.invalid) throw new BadRequestException('REFERRAL_OTP_INVALID');
    return { rewarded: outcome.rewarded, status: outcome.status };
  }
}
