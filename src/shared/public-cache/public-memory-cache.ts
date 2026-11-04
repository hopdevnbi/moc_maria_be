export class PublicCacheGenerationChanged extends Error {}

type Entry = { json: string; bytes: number; expiresAt: number };
export type CacheState = 'HIT' | 'MISS' | 'COALESCED' | 'BYPASS';
type Result<T> = { value: T; state: CacheState };

/** Process-local, bounded, public JSON cache. The caller supplies a durable revision. */
export class PublicMemoryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Result<unknown>>>();
  private generation = '';
  private bytes = 0;
  readonly counters = { hits: 0, misses: 0, coalesced: 0, evictions: 0, bypasses: 0 };

  constructor(
    private readonly options = {
      maxBytes: 32 * 1024 * 1024,
      maxEntries: 2000,
      maxEntryBytes: 512 * 1024,
    },
    private readonly now: () => number = Date.now,
  ) {}

  observe(generation: string): void {
    if (generation === this.generation) return;
    this.generation = generation;
    this.entries.clear();
    this.bytes = 0;
  }

  stats(): {
    hits: number;
    misses: number;
    coalesced: number;
    evictions: number;
    bypasses: number;
    entries: number;
    bytes: number;
    inflight: number;
  } {
    return {
      ...this.counters,
      entries: this.entries.size,
      bytes: this.bytes,
      inflight: this.inflight.size,
    };
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  async getOrLoad<T>(
    key: string,
    generation: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<Result<T>> {
    const cacheKey = generation + ':' + key;
    const entry = this.entries.get(cacheKey);
    if (entry && entry.expiresAt > this.now()) {
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, entry);
      this.counters.hits++;
      return { value: JSON.parse(entry.json) as T, state: 'HIT' };
    }
    if (entry) this.remove(cacheKey);
    const running = this.inflight.get(cacheKey);
    if (running) {
      this.counters.coalesced++;
      const result = await running;
      return {
        value: structuredClone(result.value) as T,
        state: result.state === 'MISS' ? 'COALESCED' : result.state,
      };
    }
    if (this.inflight.size >= this.options.maxEntries) {
      this.counters.bypasses++;
      return { value: await load(), state: 'BYPASS' };
    }
    this.counters.misses++;
    const task = (async (): Promise<Result<T>> => {
      const value = await load();
      if (generation !== this.generation) throw new PublicCacheGenerationChanged();
      let json: string;
      try {
        json = JSON.stringify(value);
      } catch {
        this.counters.bypasses++;
        return { value, state: 'BYPASS' };
      }
      if (typeof json !== 'string') return { value, state: 'BYPASS' };
      const bytes = Buffer.byteLength(json);
      if (bytes > this.options.maxEntryBytes || bytes > this.options.maxBytes) {
        this.counters.bypasses++;
        return { value, state: 'BYPASS' };
      }
      while (
        this.entries.size >= this.options.maxEntries ||
        this.bytes + bytes > this.options.maxBytes
      ) {
        const oldest = this.entries.keys().next().value;
        if (!oldest) break;
        this.remove(oldest);
        this.counters.evictions++;
      }
      this.remove(cacheKey);
      this.entries.set(cacheKey, {
        json,
        bytes,
        expiresAt: this.now() + ttlMs * (0.9 + Math.random() * 0.1),
      });
      this.bytes += bytes;
      return { value: JSON.parse(json) as T, state: 'MISS' };
    })();
    this.inflight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      if (this.inflight.get(cacheKey) === task) this.inflight.delete(cacheKey);
    }
  }
}
