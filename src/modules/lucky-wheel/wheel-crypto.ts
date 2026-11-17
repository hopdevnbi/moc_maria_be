import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';

export const WHEEL_PERIOD_MS = 20_000;
export const WHEEL_MAX_STAKE = 100;
export type WheelColor = 'RED' | 'BLACK' | 'GREEN';
export function wheelColor(number: number): WheelColor {
  if (!Number.isInteger(number) || number < 0 || number > 14) throw Error('WHEEL_INVALID_NUMBER');
  return number === 0 ? 'GREEN' : number % 2 === 1 ? 'RED' : 'BLACK';
}
export function wheelPayout(stake: number, choice: WheelColor, number: number): number {
  return choice === wheelColor(number) ? stake * (choice === 'GREEN' ? 14 : 2) : 0;
}
export type RoundContext = { organizationId: string; id: string; opensAt: Date };
function context(c: RoundContext): string[] {
  return ['moc-maria', 'wheel-v1', c.organizationId, c.id, c.opensAt.toISOString()];
}
export function wheelCommitment(c: RoundContext, number: number, nonce: string): string {
  wheelColor(number);
  if (!/^[0-9a-f]{64}$/.test(nonce)) throw Error('WHEEL_INVALID_NONCE');
  return createHash('sha256')
    .update(JSON.stringify([...context(c), number, nonce]))
    .digest('hex');
}
export function createWheelSecret(
  key: Buffer,
  c: RoundContext,
): { commitment: string; encrypted: string } {
  const number = randomInt(15),
    nonce = randomBytes(32).toString('hex'),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(context(c))));
  const body = Buffer.concat([cipher.update(JSON.stringify({ number, nonce })), cipher.final()]);
  return {
    commitment: wheelCommitment(c, number, nonce),
    encrypted: [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.'),
  };
}
export function revealWheelSecret(
  key: Buffer,
  c: RoundContext,
  encrypted: string,
  commitment: string,
): { number: number; nonce: string } {
  const parts = encrypted.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
    throw Error('WHEEL_INVALID_CIPHER');
  const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16)
    throw Error('WHEEL_INVALID_CIPHER');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(JSON.stringify(context(c))));
  decipher.setAuthTag(tag);
  const value = JSON.parse(
    Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'),
  ) as { number: number; nonce: string };
  if (wheelCommitment(c, value.number, value.nonce) !== commitment)
    throw Error('WHEEL_COMMITMENT_MISMATCH');
  return value;
}
