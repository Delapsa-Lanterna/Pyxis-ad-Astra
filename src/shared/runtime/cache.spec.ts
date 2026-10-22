import { describe, expect, it, vi } from 'vitest';
import { createRuntimeCache } from './cache';
import { createResidentCache } from './resident-cache';
import { appLogQueue } from './app-log-queue';
import type { AppLogEntry } from '@/shared/types';

describe('createRuntimeCache', () => {
  it('identifies capacity removals, explicit invalidation and clearing without cached values', async () => {
    const records: AppLogEntry[] = [];
    appLogQueue.install(async (entries) => {
      records.push(...entries);
    }, vi.fn());
    appLogQueue.setLevel('debug');
    try {
      const cache = createRuntimeCache<string, string>({ name: 'fixture-query', capacity: 1 });
      cache.set('first', 'private value');
      cache.set('second', 'private value');
      cache.delete('second');
      cache.reset();
      const limits = { entries: 1, bytes: 10 };
      const resident = createResidentCache<string>(() => limits, 'fixture-media');
      resident.put('active', 'private media', 4, 1);
      resident.put('idle', 'private media', 4);
      limits.bytes = 0;
      resident.trim();
      expect(resident.get('active')).toBe('private media');
      resident.release('active');
      resident.clear();
      await appLogQueue.flush();
      expect(records.map((record) => [record.code, record.fields?.kind])).toEqual([
        ['cache.evicted', 'fixture-query'],
        ['cache.removed', 'fixture-query'],
        ['cache.cleared', 'fixture-query'],
        ['cache.evicted', 'fixture-media'],
        ['cache.evicted', 'fixture-media'],
        ['cache.cleared', 'fixture-media'],
      ]);
      expect(JSON.stringify(records)).not.toContain('private');
    } finally {
      appLogQueue.setLevel('info');
    }
  });
  it('trims changed capacity in LRU order while preserving pending work', () => {
    let capacity = 2;
    const cache = createRuntimeCache<string, number, number>({ capacity: () => capacity });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.setPending('pending', 3);
    capacity = 1;
    cache.trim();
    expect([...cache.keys()]).toEqual(['a']);
    capacity = 0;
    cache.trim();
    expect(cache.size).toBe(0);
    expect(cache.getPending('pending')).toBe(3);
  });
  it('stores and retrieves values', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 4 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('evicts the oldest entry beyond capacity', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('set refreshes recency for replacement values', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);
    expect([...cache.keys()]).toEqual(['a', 'c']);
    expect(cache.peek('a')).toBe(3);
  });

  it('peek, has and iteration retain access order', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.peek('a');
    cache.has('a');
    expect([...cache.keys()]).toEqual(['a', 'b']);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
  });

  it('keeps pending values isolated per key and type-safe at the call site', () => {
    const cache = createRuntimeCache<string, number, { promise: Promise<void> }>({ capacity: 2 });
    cache.setPending('a', { promise: Promise.resolve() });
    expect(cache.getPending('a')).toBeDefined();
    cache.deletePending('a');
    expect(cache.getPending('a')).toBeUndefined();
  });

  it('iterates pending keys independently from settled values', () => {
    const cache = createRuntimeCache<string, number, { ready: boolean }>({ capacity: 2 });
    cache.set('settled', 1);
    cache.setPending('pending', { ready: true });
    expect([...cache.keys()]).toEqual(['settled']);
    expect([...cache.pendingKeys()]).toEqual(['pending']);
  });

  it('reset clears entries and pending state', () => {
    const cache = createRuntimeCache<string, number, { ready: boolean }>({ capacity: 4 });
    cache.set('a', 1);
    cache.setPending('a', { ready: true });
    cache.reset();
    expect(cache.size).toBe(0);
    expect(cache.getPending('a')).toBeUndefined();
  });

  it('keys iterates in insertion order after touch', () => {
    const cache = createRuntimeCache<string, number>({ capacity: 4 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    expect([...cache.keys()]).toEqual(['b', 'a']);
  });
});
