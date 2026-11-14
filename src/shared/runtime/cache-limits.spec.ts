import { afterEach, expect, it, vi } from 'vitest';
import { createSettingsFixture } from '@/test/fixtures/settings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('reclaims dead subscriptions and unregisters explicit releases', async () => {
  const entries: Array<{ target: object; collect: () => void; token: object }> = [];
  const unregister = vi.fn();
  vi.resetModules();
  vi.stubGlobal(
    'FinalizationRegistry',
    class<T> {
      constructor(private cleanup: (held: T) => void) {}
      register(target: object, held: T, token: object) {
        entries.push({ target, collect: () => this.cleanup(held), token });
      }
      unregister = unregister;
    },
  );
  const limits = await import('./cache-limits');
  const settings = createSettingsFixture().cacheLimits;
  limits.initializeCacheLimits(settings);
  const expired = { trim: vi.fn() },
    living = { trim: vi.fn() };
  limits.subscribeCacheLimits(expired);
  const release = limits.subscribeCacheLimits(living);
  entries[0]!.collect();
  settings.fonts.glyphEntriesPerPage = 2048;
  limits.updateCacheLimits(settings);
  expect(expired.trim).toHaveBeenCalledTimes(0);
  expect(living.trim).toHaveBeenCalledTimes(1);
  release();
  expect(unregister).toHaveBeenCalledWith(entries[1]!.token);
  settings.fonts.glyphEntriesPerPage = 1024;
  limits.updateCacheLimits(settings);
  expect(living.trim).toHaveBeenCalledTimes(1);
});
