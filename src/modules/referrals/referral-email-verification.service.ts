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

const emailLabels: Record<
  ReferralEmailLocale,
  { heading: string; expires: string; privacy: string; footer: string }
> = {
  vi: {
    heading: 'Xác minh email giới thiệu',
    expires: 'Mã có hiệu lực trong 10 phút.',
    privacy: 'Không chia sẻ mã này với bất kỳ ai.',
    footer: 'Nếu bạn không yêu cầu mã này, hãy bỏ qua email.',
  },
  en: {
    heading: 'Verify your referral email',
    expires: 'This code expires in 10 minutes.',
    privacy: 'Never share your code with anyone.',
    footer: 'If you did not request this code, you can ignore this email.',
  },
  ko: {
    heading: '추천 이메일 인증',
    expires: '인증 코드는 10분 후 만료됩니다.',
    privacy: '누구에게도 코드를 공유하지 마세요.',
    footer: '요청하지 않으셨다면 이 이메일을 무시하세요.',
  },
  ja: {
    heading: '紹介メールの確認',
    expires: 'コードの有効期限は10分です。',
    privacy: 'コードを他人に教えないでください。',
    footer: '心当たりがない場合は、このメールを無視してください。',
  },
  'zh-CN': {
    heading: '验证邀请邮箱',
    expires: '验证码将在10分钟后失效。',
    privacy: '请勿向任何人透露验证码。',
    footer: '如果您没有请求验证码，请忽略此邮件。',
  },
  ru: {
    heading: 'Подтверждение email',
    expires: 'Код действует 10 минут.',
    privacy: 'Никому не сообщайте этот код.',
    footer: 'Если вы не запрашивали код, проигнорируйте письмо.',
  },
};

/** Static, email-client-friendly markup. No links, trackers, user data or remote images. */
export function buildReferralOtpEmail(locale: ReferralEmailLocale, code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid OTP format');
  const labels = emailLabels[locale];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:32px 12px;background:#f3f6f1;font-family:Arial,Helvetica,sans-serif;color:#243b30"><div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #dce6dd;border-radius:18px;overflow:hidden"><div style="background:#23583b;color:#ffffff;padding:24px 30px;font-size:22px;font-weight:bold">Mộc Maria</div><div style="padding:30px"><h1 style="font-size:21px;line-height:1.4;margin:0 0 18px;color:#214b35">${labels.heading}</h1><div style="padding:18px 12px;text-align:center;background:#f3f7f2;border:1px solid #d7e6d8;border-radius:12px;font-size:34px;font-weight:bold;letter-spacing:7px;color:#204e34" aria-label="${code}">${code}</div><p style="font-size:15px;line-height:1.6;margin:22px 0 8px">${labels.expires}</p><p style="font-size:14px;line-height:1.6;margin:0;color:#6b5540">${labels.privacy}</p><hr style="border:0;border-top:1px solid #e7ede6;margin:25px 0"><p style="font-size:13px;line-height:1.6;margin:0;color:#617065">${labels.footer}</p></div></div><p style="text-align:center;font-size:12px;color:#69786d;margin:20px 0">Mộc Maria · Email verification</p></body></html>`;
}

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
  const html = buildReferralOtpEmail(locale, code);
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
