import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { PublicCacheInterceptor } from './public-cache.interceptor';
import { PublicMemoryCache } from './public-memory-cache';
import { PublicRevisionService, type PublicRevision } from './public-revision.service';

describe('public response cache gate', () => {
  const snapshot = (revision: string): PublicRevision => ({
    revision,
    epoch: 'epoch',
    sequence: '1',
    enabled: true,
  });
  const setup = (
    path = '/api/v1/services',
    headers = {},
  ): {
    revisions: { enabled: boolean; read: jest.Mock<Promise<PublicRevision>> };
    cache: PublicMemoryCache;
    response: { setHeader: jest.Mock };
    context: ExecutionContext;
    interceptor: PublicCacheInterceptor;
  } => {
    const revisions = { enabled: true, read: jest.fn().mockResolvedValue(snapshot('a')) };
    const cache = new PublicMemoryCache();
    const response = { setHeader: jest.fn() };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path, headers, query: {} }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return {
      revisions,
      cache,
      response,
      context,
      interceptor: new PublicCacheInterceptor(revisions as unknown as PublicRevisionService, cache),
    };
  };
  it('loads once, then checks the authoritative revision on every hit', async () => {
    const t = setup();
    const next = { handle: jest.fn(() => of({ value: 'public' })) };
    expect(await lastValueFrom(t.interceptor.intercept(t.context, next))).toEqual({
      value: 'public',
    });
    expect(await lastValueFrom(t.interceptor.intercept(t.context, next))).toEqual({
      value: 'public',
    });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(t.revisions.read).toHaveBeenCalledTimes(3);
    expect(t.response.setHeader).toHaveBeenCalledWith('X-Public-Cache', 'HIT');
    expect(t.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it('bypasses personalized requests and uncached paths', async () => {
    for (const t of [
      setup('/api/v1/services', { authorization: 'Bearer token' }),
      setup('/api/v1/services', { cookie: 'session=x' }),
      setup('/api/v1/provider-tips/a/config'),
    ]) {
      await lastValueFrom(t.interceptor.intercept(t.context, { handle: () => of('live') }));
      expect(t.revisions.read).not.toHaveBeenCalled();
      expect(t.cache.stats().entries).toBe(0);
    }
  });
  it('restarts a read when a commit changes revision while loading', async () => {
    const t = setup();
    t.revisions.read.mockResolvedValueOnce(snapshot('old')).mockResolvedValue(snapshot('new'));
    const next = {
      handle: jest.fn().mockReturnValueOnce(of('old-data')).mockReturnValue(of('new-data')),
    };
    expect(await lastValueFrom(t.interceptor.intercept(t.context, next))).toBe('new-data');
    expect(next.handle).toHaveBeenCalledTimes(2);
  });
  it('returns a live response without populating cache when the revision gate is unavailable', async () => {
    const t = setup();
    t.revisions.read.mockRejectedValueOnce(new Error('unavailable'));
    expect(
      await lastValueFrom(t.interceptor.intercept(t.context, { handle: () => of('live') })),
    ).toBe('live');
    expect(t.cache.stats().entries).toBe(0);
    const after = setup();
    after.revisions.read
      .mockResolvedValueOnce(snapshot('a'))
      .mockRejectedValue(new Error('unavailable'));
    expect(
      await lastValueFrom(after.interceptor.intercept(after.context, { handle: () => of('live') })),
    ).toBe('live');
    expect(after.cache.stats().entries).toBe(0);
  });
  it('preserves source errors instead of storing them as a success', async () => {
    const t = setup();
    await expect(
      lastValueFrom(
        t.interceptor.intercept(t.context, {
          handle: () => throwError(() => new NotFoundException()),
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(t.cache.stats().entries).toBe(0);
  });
});
