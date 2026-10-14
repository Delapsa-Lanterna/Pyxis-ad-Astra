import { createPinia, setActivePinia } from 'pinia';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsFixture } from '@/test/settings';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  loadFileHistory: vi.fn(),
  publishWindowSettings: vi.fn(async () => {}),
  listenWindowEvent: vi.fn(async (...args: unknown[]) => {
    void args;
    return async () => {};
  }),
}));

vi.mock('@/services/app-settings.service', () => ({
  saveSettings: mocks.saveSettings,
}));
vi.mock('@/services/file-history.service', () => ({ loadFileHistory: mocks.loadFileHistory }));

vi.mock('@/windows/tauri.events', () => ({
  listenWindowEvent: mocks.listenWindowEvent,
}));

vi.mock('@/windows/window-context.window', () => ({
  publishWindowSettings: mocks.publishWindowSettings,
  readWindowSettings: vi.fn(async () => ({ revision: 1, value: createSettingsFixture() })),
  acceptWindowSettings: () => true,
}));
import { saveLogDirectory, startSettingsMirror, startSettingsPersistence } from './settings-persistence.orchestrator';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { sessionUpdateFixture } from '@/test/write-result';
import type { AppSettings } from '@/shared/types';

describe('settings persistence orchestration', () => {
  let stopPersistence: () => void;
  beforeAll(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    stopPersistence = startSettingsPersistence();
  });
  afterAll(() => stopPersistence());

  beforeEach(() => {
    const project = useProjectStore();
    for (const root of [...project.manifests.keys()]) project.removeProjectManifest(root);
    mocks.loadFileHistory.mockReset();
    mocks.loadFileHistory.mockResolvedValue({ revision: 2, undoStack: [], redoStack: [] });
    mocks.saveSettings.mockReset();
    mocks.saveSettings.mockImplementation(async (snapshot: AppSettings) => snapshot);
    mocks.publishWindowSettings.mockClear();
    mocks.listenWindowEvent.mockClear();
  });

  it('persists snapshot changes and broadcasts them', async () => {
    const { nextTick } = await import('vue');
    const settings = useSettingsStore();

    settings.setTheme('dark');
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
    expect(mocks.saveSettings.mock.calls.at(-1)![0]).toMatchObject({ theme: 'dark' });
    await vi.waitFor(() => expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' })));
  });

  it('persists system-following preferences when other settings change', async () => {
    const { nextTick } = await import('vue');
    const settings = useSettingsStore();
    settings.replaceSettings(createSettingsFixture());
    await nextTick();
    await vi.waitFor(() => expect(mocks.publishWindowSettings).toHaveBeenCalled());
    mocks.saveSettings.mockClear();
    mocks.publishWindowSettings.mockClear();
    settings.setSystemTheme('dark');
    await nextTick();
    expect(mocks.saveSettings).toHaveBeenCalledTimes(0);
    expect(mocks.publishWindowSettings).toHaveBeenCalledTimes(0);
    settings.setAccent('orange');
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: null, accent: 'orange' })));
    await vi.waitFor(() => expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: null })));
  });

  it('persists the JSON preservation switch and mirrors it', async () => {
    const { nextTick } = await import('vue');
    const settings = useSettingsStore();
    settings.setPreserveOriginalJson(false);
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ preserveOriginalJson: false })));
    expect(settings.settingsSnapshot().preserveOriginalJson).toBe(false);
    settings.setPreserveOriginalJson(true);
    await nextTick();
  });

  it('persists and publishes the original-font switch to open windows', async () => {
    const settings = useSettingsStore();
    settings.setImmersiveGameFont(false);
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ immersiveGameFont: false })));
    await vi.waitFor(() => expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ immersiveGameFont: false })));
    settings.setImmersiveGameFont(true);
    await vi.waitFor(() => expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ immersiveGameFont: true })));
  });
  it('persists and publishes the selected general font', async () => {
    useSettingsStore().setGeneralFont('Microsoft YaHei');
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ generalFont: 'Microsoft YaHei' })));
    await vi.waitFor(() =>
      expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ generalFont: 'Microsoft YaHei' })),
    );
    useSettingsStore().setGeneralFont(null);
    await vi.waitFor(() => expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ generalFont: null })));
  });

  it('persists the edit history limit and updates CSV history', async () => {
    const { nextTick } = await import('vue');
    const settings = useSettingsStore();
    const setLimit = vi.spyOn(useTablesEditHistoryStore(), 'setHistoryLimit');

    settings.setEditHistoryLimit(2);
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());

    expect(setLimit).toHaveBeenCalledWith(2);
    expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ editHistoryLimit: 2 }));
  });

  it('refreshes file history after saving its independent limit', async () => {
    const update = sessionUpdateFixture('session', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready projection fixture');
    useProjectStore().registerProjectManifest(update.projection.manifest);
    useSettingsStore().setFileHistoryLimit(1);
    await vi.waitFor(() => expect(mocks.loadFileHistory).toHaveBeenCalledWith('session', 'M:/mod'));
    expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ fileHistoryLimit: 1 }));
    await vi.waitFor(() => expect(useFileHistoryStore().getHistoryStacks('M:/mod').revision).toBe(2));
  });

  it('persists both log retention values in the complete window snapshot', async () => {
    useSettingsStore().setLogRotationSizeMiB(12);
    useSettingsStore().setLogBackupCount(3);
    await vi.waitFor(() =>
      expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ logRotationSizeMiB: 12, logBackupCount: 3 })),
    );
  });

  it('saves a picked log directory and rebroadcasts the settings', async () => {
    const settings = useSettingsStore();
    mocks.saveSettings.mockImplementation(async (snapshot: AppSettings) => ({ ...snapshot, logDirectory: 'C:/custom-log' }));

    await saveLogDirectory('C:/custom-log');
    expect(settings.logDirectory).toBe('C:/custom-log');
    expect(mocks.publishWindowSettings).toHaveBeenCalledWith(expect.objectContaining({ logDirectory: 'C:/custom-log' }));
  });

  it('mirrors settings snapshots received from other windows', async () => {
    const settings = useSettingsStore();
    let mirrorHandler: ((snapshot: unknown) => void) | null = null;
    mocks.listenWindowEvent.mockImplementation(async (_event: unknown, handler: unknown) => {
      mirrorHandler = handler as (snapshot: unknown) => void;
      return async () => {};
    });

    const dispose = startSettingsMirror();
    await vi.waitFor(() => expect(mirrorHandler).not.toBeNull());
    mirrorHandler!({
      revision: 2,
      value: createSettingsFixture({
        theme: 'dark',
        generalFont: 'Arial',
        immersiveGameFont: false,
        editHistoryLimit: 3,
        fileHistoryLimit: 40,
        logRotationSizeMiB: 8,
        logBackupCount: 2,
        preserveOriginalJson: false,
      }),
    });

    expect(settings.theme).toBe('dark');
    expect(settings.generalFont).toBe('Arial');
    expect(settings.immersiveGameFont).toBe(false);
    expect(settings.preserveOriginalJson).toBe(false);
    expect(settings.settingsSnapshot()).toMatchObject({
      editHistoryLimit: 3,
      fileHistoryLimit: 40,
      logRotationSizeMiB: 8,
      logBackupCount: 2,
    });
    settings.setPreserveOriginalJson(true);
    settings.setImmersiveGameFont(true);
    dispose();
  });

  it('returns a noop dispose for an already-started persistence watcher', async () => {
    const { nextTick } = await import('vue');
    const noop = startSettingsPersistence();
    expect(typeof noop).toBe('function');

    noop();
    const settings = useSettingsStore();
    settings.setTheme('light');
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
  });

  it('releases a listener that arrives after its window lifecycle ends', async () => {
    let finish!: (unlisten: () => Promise<void>) => void;
    mocks.listenWindowEvent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stop = startSettingsMirror();
    stop();
    const unlisten = vi.fn(async () => {});
    finish(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
    mocks.listenWindowEvent.mockImplementationOnce(async () => async () => {});
    const nextStop = startSettingsMirror();
    await Promise.resolve();
    expect(mocks.listenWindowEvent).toHaveBeenCalledTimes(2);
    nextStop();
  });

  it('keeps a captured settings write from broadcasting after its lifecycle is replaced', async () => {
    const { nextTick } = await import('vue');
    let finish!: (snapshot: AppSettings) => void;
    mocks.saveSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    useSettingsStore().setTheme('dark');
    await nextTick();
    await vi.waitFor(() => expect(finish).toBeDefined());
    stopPersistence();
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    stopPersistence = startSettingsPersistence();
    finish(createSettingsFixture({ theme: 'dark' }));
    await nextTick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(useSettingsStore().theme).toBe('light');
    expect(mocks.publishWindowSettings).not.toHaveBeenCalled();
  });
});
