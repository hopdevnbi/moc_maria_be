import { randomBytes, randomUUID } from 'node:crypto';
import {
  createWheelSecret,
  revealWheelSecret,
  wheelColor,
  wheelCommitment,
  wheelPayout,
} from './wheel-crypto';
describe('Mộc wheel cryptographic contract', () => {
  const key = randomBytes(32);
  const context = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    id: randomUUID(),
    opensAt: new Date('2026-11-17T00:00:00Z'),
  };
  it('has seven red, seven black, one green and gross multipliers', () => {
    expect(
      Array.from({ length: 15 }, (_, n) => wheelColor(n)).filter((c) => c === 'RED'),
    ).toHaveLength(7);
    expect(
      Array.from({ length: 15 }, (_, n) => wheelColor(n)).filter((c) => c === 'BLACK'),
    ).toHaveLength(7);
    expect(wheelColor(0)).toBe('GREEN');
    expect(wheelPayout(10, 'GREEN', 0)).toBe(140);
    expect(wheelPayout(10, 'RED', 1)).toBe(20);
    expect(wheelPayout(10, 'BLACK', 14)).toBe(20);
    expect(wheelPayout(10, 'BLACK', 1)).toBe(0);
    expect(() => wheelColor(-1)).toThrow();
    expect(() => wheelColor(15)).toThrow();
  });
  it('binds encrypted result to Mộc, round and commitment', () => {
    const secret = createWheelSecret(key, context);
    const revealed = revealWheelSecret(key, context, secret.encrypted, secret.commitment);
    expect(wheelCommitment(context, revealed.number, revealed.nonce)).toBe(secret.commitment);
    expect(() =>
      revealWheelSecret(randomBytes(32), context, secret.encrypted, secret.commitment),
    ).toThrow();
    expect(() =>
      revealWheelSecret(key, { ...context, id: randomUUID() }, secret.encrypted, secret.commitment),
    ).toThrow();
    expect(() => revealWheelSecret(key, context, secret.encrypted, 'a'.repeat(64))).toThrow();
  });
});
