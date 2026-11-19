import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import {
  CatalogTranslationsService,
  catalogKind,
  catalogLocale,
  sourceFingerprint,
} from './catalog-translations.service';
const actor = { id: 'actor', roles: ['SUPER_ADMIN'] } as AuthUserContext;
const source = { name: 'Massage chân', description: null };
const payload = {
  name: 'Foot massage',
  status: 'PUBLISHED' as const,
  expectedVersion: 0,
  sourceFingerprint: sourceFingerprint(source),
};
describe('catalog translations', () => {
  const query = jest.fn(),
    save = jest.fn();
  const manager = { query, save };
  const transaction = jest.fn((...args: unknown[]) => {
    const fn = args[args.length - 1] as (m: typeof manager) => unknown;
    return fn(manager);
  });
  const service = new CatalogTranslationsService({ query, transaction } as unknown as DataSource);
  beforeEach(() => {
    query.mockReset();
    save.mockReset();
    transaction.mockClear();
  });
  it('accepts only allowlisted kinds and locales', () => {
    expect(catalogKind('service')).toBe('service');
    expect(catalogLocale('zh-cn')).toBe('zh-CN');
    expect(() => catalogKind('constructor')).toThrow(BadRequestException);
    expect(() => catalogLocale('vi')).toThrow(BadRequestException);
  });
  it('returns original Vietnamese when no reviewed fresh translation exists', async () => {
    query.mockResolvedValueOnce([
      { ...source, localized_name: null, localized_description: null, translated: false },
    ]);
    expect(await service.publicDetail('service', 'id', 'en')).toMatchObject({
      locale: 'vi',
      name: source.name,
    });
    expect((query.mock.calls[0] as unknown[])[0]).toContain("t.status='PUBLISHED'");
    expect((query.mock.calls[0] as unknown[])[0]).toContain('t.source_snapshot=jsonb_build_object');
    expect((query.mock.calls[0] as unknown[])[0]).toContain('c.is_published');
  });
  it('returns an approved translation and does not expose drafts/audit metadata', async () => {
    query.mockResolvedValueOnce([
      { ...source, localized_name: 'Foot massage', localized_description: null, translated: true },
    ]);
    expect(await service.publicDetail('service', 'id', 'en')).toEqual({
      entityId: 'id',
      kind: 'service',
      requestedLocale: 'en',
      locale: 'en',
      name: 'Foot massage',
      description: null,
    });
  });
  it('rejects unavailable source and non-admin edits without querying', async () => {
    await expect(
      service.save({ ...actor, roles: ['CUSTOMER'] }, 'service', 'id', 'en', payload),
    ).rejects.toThrow(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce([]);
    await expect(service.publicDetail('service', 'id', 'en')).rejects.toThrow(NotFoundException);
  });
  it('serializes saves on the source row and records audit metadata', async () => {
    query.mockResolvedValueOnce([source]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await service.save(actor, 'service', 'id', 'en', payload)).toMatchObject({
      version: 1,
      status: 'PUBLISHED',
    });
    expect((query.mock.calls[0] as unknown[])[0]).toContain('FOR UPDATE OF p');
    expect((query.mock.calls[2] as unknown[])[1]).toEqual([
      'id',
      'en',
      'Foot massage',
      null,
      JSON.stringify(source),
      'PUBLISHED',
      1,
      'actor',
    ]);
    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'catalog.translation.save', actorUserId: 'actor' }),
    );
  });
  it('rejects stale Vietnamese fingerprint or stale editor version', async () => {
    query.mockResolvedValueOnce([{ ...source, name: 'Updated' }]).mockResolvedValueOnce([]);
    await expect(service.save(actor, 'service', 'id', 'en', payload)).rejects.toThrow(
      ConflictException,
    );
    query
      .mockReset()
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([{ version: 2 }]);
    await expect(service.save(actor, 'service', 'id', 'en', payload)).rejects.toThrow(
      ConflictException,
    );
    expect(save).not.toHaveBeenCalled();
  });
  it('forbids description on variants and whitespace-only names', async () => {
    await expect(
      service.save(actor, 'variant', 'id', 'en', { ...payload, description: 'x' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.save(actor, 'service', 'id', 'en', { ...payload, name: '   ' }),
    ).rejects.toThrow(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
