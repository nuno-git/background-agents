/**
 * In-memory KV-like cache with TTL.
 * Replaces Cloudflare KV (REPOS_CACHE) for repository listing cache.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

export class MemoryCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private freshMs: number;

  constructor(freshMs = 5 * 60 * 1000) {
    this.freshMs = freshMs;
  }

  get(key: string): { value: T; isFresh: boolean } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    const isFresh = Date.now() - entry.storedAt < this.freshMs;
    return { value: entry.value, isFresh };
  }

  set(key: string, value: T, ttlMs = 3600 * 1000): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      storedAt: Date.now(),
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
