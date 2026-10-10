import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export interface SafetyPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string;
  receivedAt: string;
}
export interface SafetyVisit {
  customerName: string;
  serviceName: string;
  address: string;
}
export interface SafetySession {
  id: string;
  providerUserId: string;
  providerName: string;
  inquiryId: string;
  consentVersion: '2026-10-v1';
  startedAt: string;
  expiresAt: string;
  expectedCheckAt: string;
  status: 'TRAVELLING' | 'ARRIVED' | 'FINISHED' | 'STOPPED' | 'EXPIRED';
  sharing: boolean;
  endedAt?: string;
  sealedVisit?: string;
  sealedPoint?: string;
  pointRecordedAt?: string;
  sos?: {
    id: string;
    status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
    raisedAt: string;
    sealedPoint?: string;
    pointRecordedAt?: string;
    acknowledgedAt?: string;
    resolvedAt?: string;
    operatorId?: string;
    note?: string;
  };
}
export function active(s: SafetySession): boolean {
  return s.status === 'TRAVELLING' || s.status === 'ARRIVED';
}
export function locationState(
  s: SafetySession,
  now = Date.now(),
): 'WAITING' | 'FRESH' | 'STALE' | 'PAUSED' | 'ENDED' {
  if (!active(s) || Date.parse(s.expiresAt) <= now) return 'ENDED';
  if (!s.sharing) return 'PAUSED';
  if (!s.pointRecordedAt) return 'WAITING';
  return now - Date.parse(s.pointRecordedAt) > 60000 ? 'STALE' : 'FRESH';
}
export function maintain(s: SafetySession, now = Date.now()): SafetySession {
  if (active(s) && Date.parse(s.expiresAt) <= now) {
    s.status = 'EXPIRED';
    s.sharing = false;
    s.endedAt = s.expiresAt;
  }
  if (
    !active(s) ||
    !s.sharing ||
    (s.pointRecordedAt && now - Date.parse(s.pointRecordedAt) > 86400000)
  ) {
    delete s.sealedPoint;
    delete s.pointRecordedAt;
  }
  if (s.sos?.pointRecordedAt && now - Date.parse(s.sos.pointRecordedAt) > 86400000) {
    delete s.sos.sealedPoint;
    delete s.sos.pointRecordedAt;
  }
  if (s.endedAt && now - Date.parse(s.endedAt) > 86400000) delete s.sealedVisit;
  return s;
}
export function seal(value: unknown, key: Buffer, context: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
export function unseal<T>(value: string, key: Buffer, context: string): T {
  const bytes = Buffer.from(value, 'base64'),
    cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'),
  ) as T;
}
