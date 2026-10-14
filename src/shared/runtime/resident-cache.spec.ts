import { describe, it, expect } from 'vitest';
import { createResidentCache } from './resident-cache';
describe('resident cache working set and LRU', () => {
  it('keeps active content above budget and trims idle entries by access and bytes', () => {
    const cache = createResidentCache<string>(() => ({ entries: 2, bytes: 10 }));
    cache.put('active', 'active', 20, 1);
    cache.put('a', 'a', 4);
    cache.put('b', 'b', 4);
    cache.get('a');
    cache.put('c', 'c', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('a');
    expect(cache.stats()).toMatchObject({ activeBytes: 20, idleBytes: 8, evictions: 1 });
    cache.release('active');
    expect(cache.get('active')).toBeUndefined();
    expect(cache.stats().idleBytes).toBeLessThanOrEqual(10);
  });
  it.each([
    { entries: 0, bytes: 10 },
    { entries: 10, bytes: 0 },
  ])('uses a zero limit to release idle content only', (limits) => {
    const cache = createResidentCache<string>(() => limits);
    cache.put('a', 'a', 4, 1);
    expect(cache.get('a')).toBe('a');
    cache.release('a');
    expect(cache.get('a')).toBeUndefined();
  });
  it('ignores an old release after entry replacement', () => {
    const cache = createResidentCache<string>(() => ({ entries: 2, bytes: 10 }));
    cache.put('a', 'old', 4);
    const old = cache.retain('a');
    cache.remove('a');
    cache.put('a', 'new', 4, 1);
    old();
    expect(cache.stats().activeEntries).toBe(1);
    cache.release('a');
    expect(cache.stats().idleEntries).toBe(1);
  });
});
