import { randomBytes } from 'node:crypto';
import { locationState, maintain, seal, unseal, type SafetySession } from './safety.model';
const now = Date.now();
function session(): SafetySession {
  return {
    id: 'test',
    providerUserId: 'provider',
    providerName: 'KTV',
    inquiryId: 'inquiry',
    consentVersion: '2026-10-v1',
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    expectedCheckAt: new Date(now + 600000).toISOString(),
    status: 'TRAVELLING',
    sharing: true,
  };
}
describe('Safety privacy and freshness', () => {
  it('encrypts coordinates with context binding and rejects tampering or wrong key', () => {
    const key = randomBytes(32),
      data = { latitude: 21.01234, longitude: 105.81234 };
    const encoded = seal(data, key, 'a');
    expect(encoded).not.toContain('21.01234');
    expect(unseal(encoded, key, 'a')).toEqual(data);
    expect(() => unseal(encoded, key, 'b')).toThrow();
    expect(() => unseal(encoded, randomBytes(32), 'a')).toThrow();
  });
  it('never labels a stale, paused or expired point fresh', () => {
    const s = session();
    expect(locationState(s, now)).toBe('WAITING');
    s.pointRecordedAt = new Date(now - 61000).toISOString();
    expect(locationState(s, now)).toBe('STALE');
    s.pointRecordedAt = new Date(now - 1000).toISOString();
    expect(locationState(s, now)).toBe('FRESH');
    s.sharing = false;
    expect(locationState(s, now)).toBe('PAUSED');
    s.expiresAt = new Date(now - 1).toISOString();
    expect(locationState(s, now)).toBe('ENDED');
  });
  it('expires automatically, clears live points immediately, and limits SOS and visit retention', () => {
    const s = session();
    s.expiresAt = new Date(now - 2 * 86400000).toISOString();
    s.sealedPoint = 'point';
    s.sealedVisit = 'visit';
    s.pointRecordedAt = new Date(now - 2 * 86400000).toISOString();
    s.sos = {
      id: 'alert',
      status: 'OPEN',
      raisedAt: s.pointRecordedAt,
      pointRecordedAt: s.pointRecordedAt,
      sealedPoint: 'SOS',
    };
    maintain(s, now);
    expect(s.status).toBe('EXPIRED');
    expect(s.sharing).toBe(false);
    expect(s.sealedPoint).toBeUndefined();
    expect(s.sealedVisit).toBeUndefined();
    expect(s.sos?.sealedPoint).toBeUndefined();
    expect(s.sos?.status).toBe('OPEN');
  });
  it('pause erases the current point without resolving an incident', () => {
    const s = session();
    s.sharing = false;
    s.sealedPoint = 'point';
    s.pointRecordedAt = new Date(now).toISOString();
    s.sos = {
      id: 'alert',
      status: 'OPEN',
      raisedAt: s.pointRecordedAt,
      sealedPoint: 'SOS',
      pointRecordedAt: s.pointRecordedAt,
    };
    maintain(s, now);
    expect(s.sealedPoint).toBeUndefined();
    expect(s.sos?.sealedPoint).toBe('SOS');
  });
});
