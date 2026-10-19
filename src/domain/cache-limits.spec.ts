import { describe, it, expect } from 'vitest';
import { createSettingsFixture } from '@/test/settings';
import { readCacheLimits } from './cache-limits';
import { initializeCacheLimits, windowCacheLimits } from '@/shared/runtime/cache-limits';
describe('hidden cache settings', () => {
  it('captures an independent startup budget', () => {
    const limits = createSettingsFixture().cacheLimits;
    initializeCacheLimits(limits);
    limits.mediaData.entries = 1;
    expect(windowCacheLimits().mediaData.entries).toBe(2048);
  });
  it.each([0, 65536])('accepts the entries boundary %s', (number) => {
    const limits = createSettingsFixture().cacheLimits;
    limits.decodedImages.entries = number;
    expect(readCacheLimits(limits)).toBe(limits);
  });
  it.each([-1, 0.5, 65537, NaN])('rejects the entries value %s', (number) => {
    const limits = createSettingsFixture().cacheLimits;
    limits.thumbnails.entries = number;
    expect(() => readCacheLimits(limits)).toThrow();
  });
  it.each([0, 4096])('accepts the MiB boundary %s', (number) => {
    const limits = createSettingsFixture().cacheLimits;
    limits.decodedImages.MiB = number;
    expect(readCacheLimits(limits)).toBe(limits);
  });
  it('rejects incomplete query budgets and excessive byte limits', () => {
    const limits = createSettingsFixture().cacheLimits;
    limits.mediaData.MiB = 4097;
    expect(() => readCacheLimits(limits)).toThrow();
    limits.mediaData.MiB = 64;
    delete (limits.queries as Record<string, number>)['entity-detail'];
    expect(() => readCacheLimits(limits)).toThrow();
  });
});
