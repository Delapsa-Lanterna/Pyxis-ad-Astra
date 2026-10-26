import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import type { AppSettings, SettingsSnapshot } from '@/shared/types';
const api = vi.hoisted(() => ({ defaults: vi.fn(), save: vi.fn(), read: vi.fn(), listen: vi.fn(), history: vi.fn(), stop: vi.fn() }));
vi.mock('@/services/app-settings.service', () => ({ readDefaultSettings: api.defaults, saveSettings: api.save, readSettings: api.read }));
vi.mock('@/windows/tauri.events', () => ({ listenWindowEvent: api.listen }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  useSettingsStore();
  api.read.mockResolvedValue({ revision: 1, value: createSettingsFixture() });
  api.defaults.mockResolvedValue(createSettingsFixture());
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
  it('saves the complete official defaults and applies committed budgets', async () => {
    const { runtime, stop, settings } = await setup();
    settings.setGeneralFont('Fixture Font');
    settings.setCacheLimit('mediaData', 'entries', 17);
    settings.setLogDirectory('D:/fixture');
    await runtime.flushSettings();
    api.save.mockClear();
    await runtime.resetSettings();
    const defaults = createSettingsFixture();
    expect(api.defaults).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledExactlyOnceWith(defaults);
    expect(settings.settingsSnapshot()).toEqual(defaults);
    expect((await import('@/shared/runtime/cache-limits')).windowCacheLimits()).toEqual(defaults.cacheLimits);
    stop();
  });
  it.each(['read', 'save'] as const)('reports a reset %s failure and allows retry', async (stage) => {
    const { runtime, stop, settings } = await setup();
    settings.setGeneralFont('Fixture Font');
    await runtime.flushSettings();
    const before = settings.settingsSnapshot();
    api.save.mockClear();
    if (stage === 'read') api.defaults.mockRejectedValueOnce(new Error('defaults unavailable'));
    else api.save.mockRejectedValueOnce(new Error('save unavailable'));
    await expect(runtime.resetSettings()).rejects.toThrow('unavailable');
    expect(settings.settingsSnapshot()).toEqual(stage === 'read' ? before : createSettingsFixture());
    await runtime.resetSettings();
    expect(settings.settingsSnapshot()).toEqual(createSettingsFixture());
    stop();
  });
  it('keeps edits made while the default snapshot is saving', async () => {
    const { runtime, stop, settings } = await setup();
    settings.setGeneralFont('Fixture Font');
    await runtime.flushSettings();
    let finish!: (snapshot: SettingsSnapshot) => void;
    api.save.mockImplementationOnce(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    const resetting = runtime.resetSettings();
    await vi.waitFor(() => expect(finish).toBeDefined());
    settings.setGeneralFont('Later Font');
    finish({ revision: 3, performanceMonitorActive: false, value: createSettingsFixture() });
    await resetting;
    expect(settings.generalFont).toBe('Later Font');
    expect(api.save.mock.calls.at(-1)![0].generalFont).toBe('Later Font');
    stop();
  });
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
    finish({ revision: 2, performanceMonitorActive: false, value: { ...submitted, logDirectory: 'D:/Fixture' } });
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
