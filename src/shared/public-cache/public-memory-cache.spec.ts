import { PublicCacheGenerationChanged, PublicMemoryCache } from './public-memory-cache';
import { publicCacheTtl } from './public-cache-policy';

describe('bounded public RAM cache', () => {
  it('collapses concurrent loaders and isolates returned mutable values', async () => {
    const cache = new PublicMemoryCache();
    cache.observe('one');
    const load = jest.fn(() => Promise.resolve({ names: ['a'] }));
    const results = await Promise.all(
      Array.from({ length: 100 }, () => cache.getOrLoad('/a', 'one', 1000, load)),
    );
    expect(load).toHaveBeenCalledTimes(1);
    results[0].value.names.push('changed');
    expect((await cache.getOrLoad('/a', 'one', 1000, load)).value.names).toEqual(['a']);
    expect(cache.stats().inflight).toBe(0);
    expect(cache.stats().coalesced).toBe(99);
  });

  it('expires entries and never retains a rejected load', async () => {
    let now = 0;
    const cache = new PublicMemoryCache(undefined, () => now);
    cache.observe('a');
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('source unavailable'))
      .mockResolvedValue({ value: 1 });
    await expect(cache.getOrLoad('/a', 'a', 1000, load)).rejects.toThrow('source unavailable');
    expect(cache.stats().entries).toBe(0);
    await cache.getOrLoad('/a', 'a', 1000, load);
    now = 500;
    expect((await cache.getOrLoad('/a', 'a', 1000, load)).state).toBe('HIT');
    now = 1001;
    expect((await cache.getOrLoad('/a', 'a', 1000, load)).state).toBe('MISS');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('rejects an old in-flight generation after invalidation', async () => {
    const cache = new PublicMemoryCache();
    cache.observe('old');
    let resolve!: (value: string) => void;
    const pending = cache.getOrLoad(
      '/a',
      'old',
      1000,
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(PublicCacheGenerationChanged);
    cache.observe('new');
    resolve('obsolete');
    await assertion;
    expect(cache.stats().entries).toBe(0);
    expect((await cache.getOrLoad('/a', 'new', 1000, () => Promise.resolve('fresh'))).value).toBe(
      'fresh',
    );
  });

  it('evicts least recently used entries and enforces byte/entry budgets', async () => {
    const cache = new PublicMemoryCache({ maxBytes: 60, maxEntries: 2, maxEntryBytes: 50 });
    cache.observe('a');
    const get = (key: string, value = key): Promise<{ value: string; state: string }> =>
      cache.getOrLoad(key, 'a', 1000, () => Promise.resolve(value));
    await get('one');
    await get('two');
    await get('one');
    await get('three');
    expect((await get('one')).state).toBe('HIT');
    expect((await get('two')).state).toBe('MISS');
    expect((await get('oversized', 'x'.repeat(100))).state).toBe('BYPASS');
    expect(cache.stats().entries).toBeLessThanOrEqual(2);
    expect(cache.stats().bytes).toBeLessThanOrEqual(60);
    expect(cache.stats().evictions).toBeGreaterThan(0);
  });

  it('does not match private, bank, booking, eligibility or arbitrary paths', () => {
    for (const path of [
      '/auth/me',
      '/providers',
      '/provider-tips/a/config',
      '/appointments',
      '/services/a/b',
      '/admin/services',
    ]) {
      expect(publicCacheTtl(path)).toBeNull();
    }
    expect(publicCacheTtl('/services')).toBe(300000);
    expect(publicCacheTtl('/services/massage-chan')).toBe(300000);
    expect(publicCacheTtl('/ktv-chat/providers')).toBe(5000);
  });
});
