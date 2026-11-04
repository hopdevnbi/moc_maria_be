import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import type { ProviderDisplayService } from '../provider-display/provider-display.service';
import { ProviderShowcaseService } from './provider-showcase.service';
import { UpdateShowcaseDto } from './provider-showcase.dto';

describe('KTV public showcase editor permissions and media', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const outsiderId = '33333333-3333-4333-8333-333333333333';
  const actor = (id: string, roles: string[]): AuthUserContext =>
    ({ id, roles }) as AuthUserContext;
  const query = jest.fn();
  const save = jest.fn();
  const transaction = jest.fn();
  const display = { publicDisplay: jest.fn() };
  const db = { query, transaction, manager: { query, save } };
  const service = new ProviderShowcaseService(
    db as unknown as DataSource,
    display as unknown as ProviderDisplayService,
  );
  const empty = {
    expectedVersion: 0,
    headline: 'Nhẹ nhàng, tận tâm',
    biography: 'Giới thiệu hành trình chăm sóc',
    scheduleNote: '',
    weeklyHours: [],
    media: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('FROM provider_applications') ? [{ id, userId: ownerId }] : []),
    );
    display.publicDisplay.mockResolvedValue({ rows: [{ providerId: id, visible: true }] });
    transaction.mockImplementation((fn: (manager: unknown) => unknown) =>
      Promise.resolve(fn({ query, save })),
    );
    save.mockResolvedValue(undefined);
  });

  it('does not expose hidden public pages', async () => {
    display.publicDisplay.mockResolvedValue({ rows: [{ providerId: id, visible: false }] });
    await expect(service.publicDetail(id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('denies KTV editing someone else and permits the actual owner', async () => {
    await expect(service.editor(actor(outsiderId, ['THERAPIST']), id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect((await service.editor(actor(ownerId, ['THERAPIST']), id)).version).toBe(0);
  });

  it('permits SUPER_ADMIN to edit another KTV, not ordinary ADMIN', async () => {
    await expect(service.editor(actor(outsiderId, ['ADMIN']), id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.editor(actor(outsiderId, ['SUPER_ADMIN']), id)).resolves.toMatchObject({
      version: 0,
    });
  });

  it('rejects stale revisions to prevent overwriting concurrent edits', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('FROM provider_applications')
          ? [{ id, userId: ownerId }]
          : sql.includes('SELECT value FROM app_metadata')
            ? [{ value: { version: 3 } }]
            : [],
      ),
    );
    await expect(service.update(actor(ownerId, ['THERAPIST']), id, empty)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects overlapping weekly hours and leaves persistence untouched', async () => {
    await expect(
      service.update(actor(ownerId, ['THERAPIST']), id, {
        ...empty,
        weeklyHours: [
          { weekday: 1, startsAt: '09:00', endsAt: '12:00' },
          { weekday: 1, startsAt: '11:00', endsAt: '14:00' },
        ],
      }),
    ).rejects.toThrow('trùng');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('persists a versioned profile without changing actual services or booking slots', async () => {
    const saved = await service.update(actor(ownerId, ['THERAPIST']), id, {
      ...empty,
      weeklyHours: [{ weekday: 3, startsAt: '09:00', endsAt: '15:00' }],
    });
    expect(saved).toMatchObject({ version: 1, headline: empty.headline });
    expect(
      query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO app_metadata')),
    ).toBe(true);
    expect(save).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ event: 'provider.showcase.updated', targetUserId: ownerId }),
    );
  });

  it('validates nested media/hour DTOs before service invocation', async () => {
    const dto = plainToInstance(UpdateShowcaseDto, {
      ...empty,
      weeklyHours: [{ weekday: -1, startsAt: '09:00', endsAt: '17:00' }],
      media: [{ id: 'not-a-uuid', kind: 'GIF', url: 'file:///bad' }],
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('requires explicit consent before file upload', async () => {
    await expect(
      service.upload(
        actor(ownerId, ['THERAPIST']),
        id,
        {
          buffer: Buffer.from('1234'),
          size: 4,
          mimetype: 'video/mp4',
        },
        undefined,
      ),
    ).rejects.toThrow('xác nhận');
  });
});
