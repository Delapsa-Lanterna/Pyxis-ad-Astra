import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsFixture } from '@/test/settings';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import type { AppSettings, SettingsSnapshot } from '@/shared/types';
const api = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), listen: vi.fn(), history: vi.fn(), stop: vi.fn() }));
vi.mock('@/services/app-settings.service', () => ({ saveSettings: api.save, readSettings: api.read }));
vi.mock('@/windows/tauri.events', () => ({ listenWindowEvent: api.listen }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  useSettingsStore();
  api.read.mockResolvedValue({ revision: 1, value: createSettingsFixture() });
  api.listen.mockResolvedValue(api.stop);
  api.history.mockResolvedValue(undefined);
  let revision = 1;
  api.save.mockImplementation(async (value: AppSettings) => ({ revision: ++revision, value }));
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));
async function setup() {
  const runtime = await import('./settings-persistence.orchestrator');
  await runtime.initializeSettings();
  return { runtime, stop: runtime.startSettingsPersistence(api.history), settings: useSettingsStore() };
}
describe('formal settings commits', () => {
  it('listens before reading and flushes a same-turn edit once', async () => {
    const { runtime, stop, settings } = await setup();
    const { windowCacheLimits } = await import('@/shared/runtime/cache-limits');
    settings.setCacheLimit('mediaData', 'entries', 17);
    expect(windowCacheLimits().mediaData.entries).toBe(2048);
    expect(api.listen.mock.invocationCallOrder[0]).toBeLessThan(api.read.mock.invocationCallOrder[0]!);
    settings.setGeneralFont('Fixture Font');
    settings.setExpandFieldDescriptions(true);
    await runtime.flushSettings();
    expect(windowCacheLimits().mediaData.entries).toBe(17);
    expect(api.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ generalFont: 'Fixture Font', expandFieldDescriptions: true }),
    );
    await runtime.flushSettings();
    expect(api.save).toHaveBeenCalledOnce();
    stop();
  });
  it('preserves newer edits while accepting normalized values from the submitted snapshot', async () => {
    const { runtime, stop, settings } = await setup();
    let finish!: (snapshot: SettingsSnapshot) => void;
    api.save.mockImplementationOnce(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    settings.setLogDirectory('D:/fixture');
    await nextTick();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const submitted = api.save.mock.calls[0]![0];
    settings.setGeneralFont('Later Font');
    finish({ revision: 2, value: { ...submitted, logDirectory: 'D:/Fixture' } });
    await runtime.flushSettings();
    expect(settings.generalFont).toBe('Later Font');
    expect(settings.logDirectory).toBe('D:/Fixture');
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1]![0].logDirectory).toBe('D:/Fixture');
    stop();
  });
  it('retains a failed edit and retries its current snapshot', async () => {
    const { runtime, stop, settings } = await setup();
    api.save.mockRejectedValue(new Error('disk failure'));
    const { windowCacheLimits } = await import('@/shared/runtime/cache-limits');
    settings.setGeneralFont('Retry Font');
    settings.setCacheLimit('thumbnails', 'MiB', 8);
    await expect(runtime.flushSettings()).rejects.toThrow('disk failure');
    expect(settings.generalFont).toBe('Retry Font');
    expect(windowCacheLimits().thumbnails.MiB).toBe(32);
    expect(api.save).toHaveBeenCalledOnce();
    api.save.mockImplementation(async (value: AppSettings) => ({ revision: 2, value }));
    await runtime.flushSettings();
    expect(windowCacheLimits().thumbnails.MiB).toBe(8);
    stop();
  });
  it('accepts newer mirror revisions and rereads on focus', async () => {
    const runtime = await import('./settings-persistence.orchestrator');
    await runtime.initializeSettings();
    const stop = runtime.startSettingsMirror();
    const receive = api.listen.mock.calls[0]![1];
    const next = createSettingsFixture({ generalFont: 'Latest Font', expandFieldDescriptions: true });
    next.cacheLimits.decodedImages.entries = 7;
    receive({ revision: 4, value: next });
    receive({ revision: 3, value: createSettingsFixture({ generalFont: 'Earlier Font' }) });
    expect(useSettingsStore().generalFont).toBe('Latest Font');
    expect(useSettingsStore().expandFieldDescriptions).toBe(true);
    expect((await import('@/shared/runtime/cache-limits')).windowCacheLimits().decodedImages.entries).toBe(7);
    window.dispatchEvent(new Event('focus'));
    await nextTick();
    expect(api.read).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new Event('pagehide'));
  });
  it('separates committed settings from history refresh diagnostics', async () => {
    const { runtime, stop, settings } = await setup();
    api.history.mockRejectedValue(new Error('history failure'));
    settings.setGeneralFont('Committed Font');
    await runtime.flushSettings();
    expect(api.save).toHaveBeenCalledOnce();
    stop();
  });
});
