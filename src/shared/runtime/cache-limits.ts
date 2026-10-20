import type { CacheLimits } from '@/shared/types';

let limits: CacheLimits;
const subscribers = new Set<WeakRef<{ trim(): void }>>();

export function initializeCacheLimits(value: CacheLimits): void {
  updateCacheLimits(value);
}

export function updateCacheLimits(value: CacheLimits): void {
  if (JSON.stringify(limits) === JSON.stringify(value)) return;
  limits = structuredClone(value);
  for (const reference of subscribers) {
    const cache = reference.deref();
    if (cache) cache.trim();
    else subscribers.delete(reference);
  }
}

export function subscribeCacheLimits(cache: { trim(): void }): () => void {
  const reference = new WeakRef(cache);
  subscribers.add(reference);
  return () => subscribers.delete(reference);
}

export function windowCacheLimits(): Readonly<CacheLimits> {
  return limits;
}
