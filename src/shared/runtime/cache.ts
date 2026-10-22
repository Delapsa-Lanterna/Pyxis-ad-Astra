/**
 * Runtime cache primitive: access-order LRU capacity eviction,
 * typed pending storage and full reset. Semantic layers (invalidation
 * matching, batch loading, performance instrumentation) are implemented on top by the
 * individual cache services. State is plain data held in a closure; caches needing
 * reactive views (such as the media projection) handle that in their own service layer,
 * keeping this primitive framework-agnostic.
 */

import { debugLog } from './app-log-queue';
let nextCacheId = 0;

export interface RuntimeCacheOptions<TKey> {
  name?: string;
  capacity: number | (() => number);
  onEvict?: (key: TKey) => void;
}

export interface RuntimeCache<TKey extends string, TValue, TPending> {
  readonly size: number;
  get(key: TKey): TValue | undefined;
  peek(key: TKey): TValue | undefined;
  has(key: TKey): boolean;
  set(key: TKey, value: TValue): void;
  delete(key: TKey): void;
  keys(): IterableIterator<TKey>;
  pendingKeys(): IterableIterator<TKey>;
  getPending(key: TKey): TPending | undefined;
  setPending(key: TKey, pending: TPending): void;
  deletePending(key: TKey): void;
  reset(): void;
  trim(): void;
}

export function createRuntimeCache<TKey extends string, TValue, TPending = never>(
  options: RuntimeCacheOptions<TKey>,
): RuntimeCache<TKey, TValue, TPending> {
  const { capacity } = options;
  const onEvict = options.onEvict;
  const cacheId = String(++nextCacheId);
  const cache = new Map<TKey, TValue>();
  const pending = new Map<TKey, TPending>();

  function touchKey(key: TKey): void {
    const value = cache.get(key);
    if (value === undefined) return;
    cache.delete(key);
    cache.set(key, value);
  }

  function evictOverCapacity(): void {
    while (cache.size > (typeof capacity === 'function' ? capacity() : capacity)) {
      const oldest = cache.keys().next().value as TKey | undefined;
      if (oldest === undefined) return;
      cache.delete(oldest);
      onEvict?.(oldest);
      debugLog('cache.evicted', () => ({ cacheId, kind: options.name ?? 'runtime', reason: 'capacity', remaining: String(cache.size) }));
    }
  }

  return {
    trim: evictOverCapacity,
    get size() {
      return cache.size;
    },
    get(key) {
      const value = cache.get(key);
      if (value === undefined) return undefined;
      touchKey(key);
      return value;
    },
    peek(key) {
      return cache.get(key);
    },
    has(key) {
      return cache.has(key);
    },
    set(key, value) {
      cache.delete(key);
      cache.set(key, value);
      evictOverCapacity();
    },
    delete(key) {
      if (cache.delete(key)) debugLog('cache.removed', () => ({ cacheId, kind: options.name ?? 'runtime' }));
    },
    keys() {
      return cache.keys();
    },
    pendingKeys() {
      return pending.keys();
    },
    getPending(key) {
      return pending.get(key);
    },
    setPending(key, value) {
      pending.set(key, value);
    },
    deletePending(key: TKey) {
      pending.delete(key);
    },
    reset() {
      debugLog('cache.cleared', () => ({ cacheId, kind: options.name ?? 'runtime', entries: String(cache.size) }));
      cache.clear();
      pending.clear();
    },
  };
}
