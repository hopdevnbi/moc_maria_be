import { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderWorkspaceService } from './provider-workspace.service';
const id = 'a'.repeat(64);
const actor = { id: 'ktv', roles: ['THERAPIST'] } as AuthUserContext;
describe('KTV completion reports', () => {
  function setup(overrides: Record<string, unknown> = {}): {
    service: ProviderWorkspaceService;
    save: jest.Mock;
    query: jest.Mock;
  } {
    let value = {
      id,
      providerUserId: 'ktv',
      customerId: 'customer',
      status: 'CONTACTED',
      requestedAt: new Date(Date.now() - 3600000).toISOString(),
      ...overrides,
    };
    const query = jest.fn().mockImplementation((sql: string, params: string[]) => {
      if (sql.startsWith('SELECT')) return Promise.resolve([{ value }]);
      value = JSON.parse(params[1]) as typeof value;
      return Promise.resolve([]);
    });
    const save = jest.fn().mockResolvedValue({});
    const db = {
      transaction: (fn: (m: EntityManager) => Promise<unknown>) =>
        fn({ query, save } as unknown as EntityManager),
    } as unknown as DataSource;
    return { service: new ProviderWorkspaceService(db), query, save };
  }
  const dto = {
    servicePerformedConfirmed: true,
    reason: 'KTV xác nhận đã phục vụ xong khách hàng.',
  };
  it('persists one completion report and audit, retaining the inquiry state and no verified appointment', async () => {
    const { service, query, save } = setup();
    const first = await service.complete(actor, id, dto);
    const second = await service.complete(actor, id, dto);
    expect(first).toEqual(second);
    expect(save).toHaveBeenCalledTimes(1);
    const writes = query.mock.calls.filter((call: unknown[]) =>
      String(call[0]).startsWith('UPDATE'),
    );
    expect(writes).toHaveLength(1);
    expect(
      query.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes('INSERT INTO appointments'),
      ),
    ).toBe(false);
  });
  it.each([
    { status: 'PENDING' },
    { status: 'CANCELLED' },
    { appointmentId: 'official' },
    { archivedAt: 'archived' },
    { requestedAt: new Date(Date.now() + 3600000).toISOString() },
  ])('rejects invalid state before any write: %s', async (overrides) => {
    const { service, save } = setup(overrides);
    await expect(service.complete(actor, id, dto)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects customers, other KTVs and missing explicit service attestation', async () => {
    const { service, save } = setup();
    await expect(service.complete({ ...actor, roles: ['CUSTOMER'] }, id, dto)).rejects.toThrow();
    await expect(service.complete({ ...actor, id: 'other-ktv' }, id, dto)).rejects.toThrow();
    await expect(
      service.complete(actor, id, { ...dto, servicePerformedConfirmed: false }),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
