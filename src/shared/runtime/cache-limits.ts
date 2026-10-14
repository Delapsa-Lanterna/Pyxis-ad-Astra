import type { CacheLimits } from '@/shared/types';

let limits: CacheLimits;

export function initializeCacheLimits(value: CacheLimits): void {
  limits = structuredClone(value);
}

export function windowCacheLimits(): Readonly<CacheLimits> {
  return limits;
}
