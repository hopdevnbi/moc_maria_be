import { randomBytes } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import type { RoleName } from '../identity/identity.constants';
import { KtvSafetyService } from './safety.service';
import type { SafetySession } from './safety.model';

const actor = (id: string, roles: RoleName[], isActive = true): AuthUserContext => ({
  id,
  email: null,
  phone: null,
  displayName: id,
  isActive,
  mustChangePassword: false,
  sessionId: 'qa-session',
  roles,
  permissions: [],
});

describe('Consent-based tracking for Super Admin and KTV', () => {
  const originalKey = process.env['KTV_SAFETY_ENCRYPTION_KEY'];
  let service: KtvSafetyService;
  let store: Map<string, SafetySession>;
  const adminA = actor('admin-a', ['SUPER_ADMIN']);
  const adminB = actor('admin-b', ['SUPER_ADMIN']);
  const ktv = actor('ktv', ['THERAPIST']);
  const customer = actor('customer', ['CUSTOMER']);
  const shift = (): { consent: true; expectedCheckAt: string } => ({
    consent: true,
    expectedCheckAt: new Date(Date.now() + 2 * 3600000).toISOString(),
  });

  beforeEach(() => {
    process.env['KTV_SAFETY_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    store = new Map();
    const query = jest.fn((sql: string, params: unknown[] = []): Promise<unknown[]> => {
      if (sql.startsWith('INSERT INTO app_metadata')) {
        store.set(
          String(params[0]).split('mocmaria.safety.session.')[1],
          JSON.parse(String(params[1])) as SafetySession,
        );
        return Promise.resolve([]);
      }
      if (sql.includes('SELECT value FROM app_metadata WHERE key=$1')) {
        const item = store.get(String(params[0]).replace('mocmaria.safety.session.', ''));
        return Promise.resolve(item ? [{ value: item }] : []);
      }
      if (sql.includes('SELECT key FROM app_metadata')) {
        return Promise.resolve(
          [...store.keys()].map((id) => ({ key: 'mocmaria.safety.session.' + id })),
        );
      }
      if (sql.includes('SELECT value FROM app_metadata WHERE key LIKE')) {
        return Promise.resolve(
          [...store.values()]
            .filter((s) => !params[1] || s.providerUserId === params[1])
            .map((value) => ({ value })),
        );
      }
      return Promise.resolve([]);
    });
    const manager = { query, save: jest.fn().mockResolvedValue(undefined) };
    const db = {
      query,
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) =>
        fn(manager as unknown as EntityManager),
      ),
    };
    service = new KtvSafetyService(db as unknown as DataSource);
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env['KTV_SAFETY_ENCRYPTION_KEY'];
    else process.env['KTV_SAFETY_ENCRYPTION_KEY'] = originalKey;
  });

  it('rejects inactive accounts and customers before collecting or reading GPS', async () => {
    await expect(service.startShift(customer, shift())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.own(customer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.startShift(actor('inactive', ['SUPER_ADMIN'], false), shift()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.start(adminA, {
        consent: true,
        inquiryId: 'a'.repeat(64),
        expectedCheckAt: shift().expectedCheckAt,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.size).toBe(0);
  });

  it('allows Super Admin to share their own GPS and other Super Admins to monitor it', async () => {
    const started = (await service.startShift(adminA, shift())) as { id: string; purpose: string };
    expect(started.purpose).toBe('SHIFT');
    const own = (await service.own(adminA)) as Array<{ id: string }>;
    expect(own.map((s) => s.id)).toContain(started.id);
    expect(await service.own(adminB)).toEqual([]);
    await service.point(adminA, started.id, {
      latitude: 21.01,
      longitude: 105.81,
      accuracy: 15,
      recordedAt: new Date().toISOString(),
    });
    const monitoring = (await service.monitor(adminB)) as {
      sessions: Array<{ id: string; point: { latitude: number }; trail: unknown[] }>;
    };
    const shared = monitoring.sessions.find((s) => s.id === started.id);
    expect(shared?.point.latitude).toBe(21.01);
    expect(shared?.trail).toHaveLength(1);
    expect(JSON.stringify(store.get(started.id))).not.toContain('21.01');
    await expect(
      service.point(adminB, started.id, {
        latitude: 21.03,
        longitude: 105.82,
        accuracy: 15,
        recordedAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.action(adminA, started.id, { action: 'STOP' });
    expect(
      ((await service.monitor(adminB)) as { sessions: Array<{ trail: unknown[] }> }).sessions[0]
        .trail,
    ).toEqual([]);
  });

  it('still allows therapists to start a voluntary shift', async () => {
    const started = (await service.startShift(ktv, shift())) as { purpose: string };
    expect(started.purpose).toBe('SHIFT');
  });
});
