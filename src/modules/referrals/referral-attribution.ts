import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { EntityManager } from 'typeorm';

export const REFERRAL_CODE_PATTERN = /^[A-F0-9]{20}$/;
export const DEVICE_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function normalizedIp(value?: string): string | undefined {
  const ip = value?.trim().replace(/^::ffff:/i, '');
  return ip && isIP(ip) ? ip.toLowerCase() : undefined;
}
// Opt-in only after validating the ingress overwrites X-Real-IP. Do not trust
// arbitrary forwarded headers, and never modify global Express trust-proxy.
export function trustedReferralIp(request: {
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const peer = normalizedIp(request.socket?.remoteAddress);
  if (!peer) return undefined;
  if (process.env['REFERRAL_DIRECT_CLIENT_IP'] === '1') return peer;
  const allowed = (process.env['REFERRAL_TRUSTED_PROXY_IPS'] ?? '')
    .split(',')
    .map((v) => normalizedIp(v));
  const header = request.headers['x-real-ip'];
  return allowed.includes(peer) && typeof header === 'string' ? normalizedIp(header) : undefined;
}
export function networkSignal(
  ip?: string,
  secret = process.env['REFERRAL_SIGNAL_SECRET'],
): string | null {
  const valid = normalizedIp(ip);
  return valid && secret && secret.length >= 32
    ? createHmac('sha256', secret)
        .update('referral-network:v1:' + valid)
        .digest('hex')
    : null;
}

export function deviceSignal(
  deviceId?: string,
  secret = process.env['REFERRAL_SIGNAL_SECRET'],
): string | null {
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId) || !secret || secret.length < 32) return null;
  return createHmac('sha256', secret)
    .update('referral-device:v1:' + deviceId.toLowerCase())
    .digest('hex');
}

export function riskFor(
  sharedDevice: boolean,
  highVelocity: boolean,
  repeatedNetwork = false,
): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;
  if (sharedDevice) {
    flags.push('SHARED_BROWSER');
    score += 35;
  }
  if (highVelocity) {
    flags.push('HIGH_REFERRAL_VELOCITY');
    score += 25;
  }
  if (repeatedNetwork) {
    flags.push('SHARED_NETWORK');
    score += 25;
  }
  return { score: Math.min(100, score), flags };
}

// Attribution only. Risk signals do not alter registration, eligibility, or status.
export async function recordReferral(
  manager: EntityManager,
  referredId: string,
  code?: string,
  deviceId?: string,
  clientIp?: string,
): Promise<void> {
  if (!code || !REFERRAL_CODE_PATTERN.test(code)) return;
  const [target] = await manager.query<{ user_id: string; reward_coins: number }[]>(
    `
    SELECT c.user_id,s.reward_coins FROM referral_codes c
    JOIN users u ON u.id=c.user_id AND u.is_active
    CROSS JOIN referral_settings s
    WHERE c.code=$1 AND s.id=1 AND s.enabled AND c.user_id<>$2
  `,
    [code, referredId],
  );
  if (!target) return;
  const hash = deviceSignal(deviceId);
  const network = networkSignal(clientIp);
  const [counts] = await manager.query<
    { shared: boolean; velocity: boolean; repeatedNetwork: boolean }[]
  >(
    `
    SELECT EXISTS(SELECT 1 FROM referrals WHERE device_hash=$1 AND created_at>now()-interval '30 days') AS shared,
      (SELECT count(*)>=10 FROM referrals WHERE referrer_id=$2 AND created_at>now()-interval '24 hours') AS velocity,
      (SELECT count(*)>=3 FROM referrals WHERE network_hash=$3 AND created_at>now()-interval '1 hour') AS "repeatedNetwork"
  `,
    [hash, target.user_id, network],
  );
  const risk = riskFor(counts.shared, counts.velocity, counts.repeatedNetwork);
  await manager.query(
    `
    INSERT INTO referrals(referrer_id,referred_id,reward_coins,risk_score,risk_flags,device_hash,network_hash)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(referred_id) DO NOTHING
  `,
    [
      target.user_id,
      referredId,
      target.reward_coins,
      risk.score,
      JSON.stringify(risk.flags),
      hash,
      network,
    ],
  );
}
