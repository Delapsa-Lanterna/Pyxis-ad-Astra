import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import type { AppSettings, SettingsSnapshot } from '@/shared/types';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
const api = vi.hoisted(() => ({
  defaults: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  listen: vi.fn(),
  history: vi.fn(),
  stop: vi.fn(),
  detect: vi.fn(),
  scan: vi.fn(),
  open: vi.fn(),
  workspaceSave: vi.fn(),
}));
vi.mock('@/services/directory.service', () => ({ detectDirectoryTarget: api.detect, scanDirectoryGameOverview: api.scan }));
vi.mock('@/services/project-session.service', () => ({ openProject: api.open }));
vi.mock('@/services/project-sync.service', () => ({ closeProjectSession: vi.fn() }));
vi.mock('@/services/workspace-state.service', () => ({ savePersistedWorkspace: api.workspaceSave, loadPersistedWorkspace: vi.fn() }));
vi.mock('@/services/core-assets.service', () => ({ invalidateCoreCacheForRoot: vi.fn(async () => {}) }));
vi.mock('@/services/app-settings.service', () => ({
  readDefaultSettings: api.defaults,
  saveSettings: api.save,
  readSettings: api.read,
  listenSettingsChanged: api.listen,
}));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
beforeEach(async () => {
  vi.resetModules();
  const { initializeWindowsPathCase } = await import('@/shared/lib/paths');
  const { windowsPathCaseFixture } = await import('@/test/fixtures/windows-path-case');
  initializeWindowsPathCase(windowsPathCaseFixture);
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  useSettingsStore();
  api.read.mockResolvedValue({ revision: 1, value: createSettingsFixture() });
  api.defaults.mockResolvedValue(createSettingsFixture());
  api.listen.mockResolvedValue(api.stop);
  api.history.mockResolvedValue(undefined);
  api.workspaceSave.mockResolvedValue(undefined);
  let revision = 1;
  api.save.mockImplementation(async (value: AppSettings) => ({ revision: ++revision, value }));
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));
async function setup() {
  const runtime = await import('./settings-persistence.orchestrator');
  const { switchWorkspaceCoreSource } = await import('./workspace-core-source.orchestrator');
  await runtime.initializeSettings();
  return {
    runtime,
    stop: runtime.startSettingsPersistence(api.history),
    settings: useSettingsStore(),
    switchSource: switchWorkspaceCoreSource,
  };
}
describe('formal settings commits', () => {
  it('saves toast durations and restores their defaults through reset', async () => {
    const { runtime, stop, settings } = await setup();
    settings.setToastDuration('success', 0);
    settings.setToastDuration('error', 3600);
    await runtime.flushSettings();
    expect(api.save.mock.lastCall![0].toastDurations).toEqual({ success: 0, info: 7, warning: 7, error: 3600 });
    await runtime.resetSettings(vi.fn());
    expect(settings.toastDurations).toEqual({ success: 5, info: 7, warning: 7, error: 0 });
    expect(api.save.mock.lastCall![0].toastDurations).toEqual(settings.toastDurations);
    stop();
  });
  const stages = ['success', 'clear', 'reset', 'cancel', 'validate', 'close', 'save', 'open', 'overview', 'workspace'] as const;
  it.each(stages)('switches the whole source lifecycle: %s', async (stage) => {
    const previous = createSettingsFixture({ starsectorRoot: 'G:/previous' });
    useSettingsStore().replaceSettings(previous);
    useSettingsStore().confirmSavedSettings(previous);
    api.read.mockResolvedValue({ revision: 1, value: previous });
    const { runtime, stop, settings, switchSource } = await setup();
    const workspace = useWorkspaceStore();
    const overview = { starsectorRoot: 'G:/workspace', modsDir: 'G:/workspace/mods', coreAvailable: true, mods: [], warnings: [] };
    workspace.setGameOverview(overview);
    workspace.registerMod({ modRoot: 'M:/sample', displayName: 'Sample', version: '', status: 'ready' });
    useProjectStore().registerProjectManifest(sessionUpdateFixture('before', 'M:/sample').projection.manifest);
    api.detect.mockResolvedValue({ kind: stage === 'validate' ? 'unknown' : 'game-root' });
    api.scan.mockResolvedValue(overview);
    api.open.mockImplementation(async () => ({
      ...sessionUpdateFixture('after', 'M:/sample').projection.manifest,
      starsectorRoot: settings.savedStarsectorRoot ?? overview.starsectorRoot,
    }));
    if (stage === 'save') api.save.mockRejectedValueOnce(new Error('settings unavailable'));
    if (stage === 'open') api.open.mockRejectedValueOnce(new Error('mod unavailable'));
    if (stage === 'overview') api.scan.mockRejectedValueOnce(new Error('overview unavailable'));
    if (stage === 'workspace') api.workspaceSave.mockRejectedValueOnce(new Error('workspace unavailable'));
    const close = vi.fn(async () => {
      await useSaveCommandStore().settleCloseActions();
      await runtime.flushSettings();
      if (stage === 'close') throw new Error('close unavailable');
      return {
        status: stage === 'cancel' ? ('cancelled' as const) : ('closed' as const),
        destroyedWindows: [],
        releasedSessions: stage === 'cancel' ? [] : ['before'],
        diagnostic: null,
      };
    });
    const root = stage === 'clear' || stage === 'reset' ? null : 'G:/selected';
    const changeSource = (root: string | null, commit: () => Promise<void>) => switchSource(root, close, commit);
    const switching = stage === 'reset' ? runtime.resetSettings(changeSource) : runtime.saveStarsectorRoot(root, changeSource);
    if (['validate', 'close', 'save', 'overview', 'workspace'].includes(stage)) await expect(switching).rejects.toThrow();
    else expect(await switching).toBe(stage !== 'cancel');
    expect(settings.starsectorRoot).toBe(['cancel', 'validate', 'close', 'save'].includes(stage) ? 'G:/previous' : root);
    expect(workspace.gameOverview?.starsectorRoot).toBe('G:/workspace');
    expect(close).toHaveBeenCalledTimes(stage === 'validate' ? 0 : 1);
    if (stage === 'cancel' || stage === 'validate' || stage === 'close') expect(useProjectStore().getSessionId('M:/sample')).toBe('before');
    else if (stage === 'overview') expect(useProjectStore().getSessionId('M:/sample')).toBeNull();
    else if (stage === 'open') expect(workspace.modOpeningFailureList.map((item) => item.modRoot)).toEqual(['M:/sample']);
    else
      expect(workspace.activeManifest ?? useProjectStore().getManifest('M:/sample')).toMatchObject({
        sessionId: 'after',
        starsectorRoot: stage === 'save' ? 'G:/previous' : (root ?? 'G:/workspace'),
      });
    expect(api.workspaceSave.mock.calls.every(([state]) => state.mods.length === (stage === 'open' ? 0 : 1))).toBe(true);
    expect(api.defaults).toHaveBeenCalledTimes(stage === 'reset' ? 1 : 0);
    expect(api.workspaceSave).toHaveBeenCalledTimes(stage === 'validate' ? 0 : 1);
    stop();
  });

  it.each(['save', 'reset'] as const)('commits a %s with the same formal root directly', async (action) => {
    const { runtime, stop, settings } = await setup();
    settings.setGeneralFont('Direct Font');
    await runtime.flushSettings();
    const changeSource = vi.fn();
    if (action === 'save') await runtime.saveStarsectorRoot(null, changeSource);
    else await runtime.resetSettings(changeSource);
    expect(changeSource).not.toHaveBeenCalled();
    expect(settings.generalFont).toBe(action === 'save' ? 'Direct Font' : createSettingsFixture().generalFont);
    expect(api.workspaceSave).not.toHaveBeenCalled();
    stop();
  });
  it('waits for existing actions and actual directory openings before changing the source', async () => {
    const { runtime, stop, settings, switchSource } = await setup();
    const commands = useSaveCommandStore();
    let finishAction!: () => void, finishOpen!: (value: ReturnType<typeof sessionUpdateFixture>['projection']['manifest']) => void;
    const action = commands.trackCloseAction(
      new Promise<void>((resolve) => {
        finishAction = resolve;
      }),
    );
    api.open.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOpen = resolve;
      }),
    );
    api.open.mockImplementation(async () => sessionUpdateFixture('after', 'M:/waiting').projection.manifest);
    api.detect.mockResolvedValue({ kind: 'game-root' });
    const { openWorkspaceMod } = await import('./workspace-opening.orchestrator');
    const opening = openWorkspaceMod('M:/waiting', null);
    const close = vi.fn(async () => {
      await commands.settleCloseActions();
      return { status: 'closed' as const, destroyedWindows: [], releasedSessions: ['before'], diagnostic: null };
    });
    const switching = runtime.saveStarsectorRoot('G:/selected', (root, commit) => switchSource(root, close, commit));
    await flushPromises();
    expect(api.detect).not.toHaveBeenCalled();
    finishAction();
    await action;
    await flushPromises();
    expect(api.detect).not.toHaveBeenCalled();
    finishOpen(sessionUpdateFixture('before', 'M:/waiting').projection.manifest);
    await opening;
    await switching;
    expect(close).toHaveBeenCalledOnce();
    expect(useProjectStore().getSessionId('M:/waiting')).toBe('after');
    expect(settings.savedStarsectorRoot).toBe('G:/selected');
    stop();
  });
  it.each([
    ['closed', false],
    ['closed', true],
    ['cancelled', false],
    ['cancelled', true],
    ['error', false],
    ['error', true],
  ] as const)('holds closing through the final snapshot: %s, rejected=%s', async (status, rejected) => {
    const { runtime, stop, settings, switchSource } = await setup();
    const commands = useSaveCommandStore();
    let finish!: () => void, fail!: (error: Error) => void;
    const finalError = new Error('final snapshot unavailable'),
      closeError = new Error('close unavailable');
    api.workspaceSave.mockReturnValueOnce(
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    api.detect.mockResolvedValue({ kind: 'game-root' });
    const close = async () => {
      await commands.settleCloseActions();
      if (status === 'error') throw closeError;
      return { status, destroyedWindows: [], releasedSessions: [], diagnostic: null };
    };
    const switching = runtime
      .saveStarsectorRoot('G:/selected', (root, commit) => switchSource(root, close, commit))
      .then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
    await vi.waitFor(() => expect(api.workspaceSave).toHaveBeenCalledOnce());
    let settled = false;
    const closing = commands.settleCloseActions().then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await flushPromises();
    expect(settled).toBe(false);
    expect(api.workspaceSave).toHaveBeenCalledOnce();
    if (rejected) fail(finalError);
    else finish();
    const result = await switching;
    expect(result.error).toBe(rejected ? finalError : status === 'error' ? closeError : null);
    if (!result.error) expect(result.value).toBe(status === 'closed');
    expect(await closing).toBe(rejected ? finalError : null);
    expect(settings.savedStarsectorRoot).toBe(status === 'closed' ? 'G:/selected' : null);
    await commands.settleCloseActions();
    stop();
  });
  it('saves the complete official defaults and applies committed budgets', async () => {
    const { runtime, stop, settings } = await setup();
    settings.setGeneralFont('Fixture Font');
    settings.setCacheLimit('mediaData', 'entries', 17);
    settings.setImmersiveFontDirectory('F:/fonts');
    settings.setLogDirectory('D:/fixture');
    await runtime.flushSettings();
    api.save.mockClear();
    await runtime.resetSettings(vi.fn());
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
    await expect(runtime.resetSettings(vi.fn())).rejects.toThrow('unavailable');
    expect(settings.settingsSnapshot()).toEqual(stage === 'read' ? before : createSettingsFixture());
    await runtime.resetSettings(vi.fn());
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
    const resetting = runtime.resetSettings(vi.fn());
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
    settings.setImmersiveFontDirectory('F:/fonts');
    await runtime.flushSettings();
    expect(windowCacheLimits().mediaData.entries).toBe(17);
    expect(api.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ generalFont: 'Fixture Font', expandFieldDescriptions: true, immersiveFontDirectory: 'F:/fonts' }),
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
    const receive = api.listen.mock.calls[0]![0];
    const next = createSettingsFixture({ generalFont: 'Latest Font', expandFieldDescriptions: true, immersiveFontDirectory: 'F:/fonts' });
    next.cacheLimits.decodedImages.entries = 7;
    next.toastDurations = { success: 0, info: 3600, warning: 8, error: 9 };
    receive({ revision: 4, value: next });
    receive({ revision: 3, value: createSettingsFixture({ generalFont: 'Earlier Font' }) });
    expect(useSettingsStore().generalFont).toBe('Latest Font');
    expect(useSettingsStore().toastDurations).toEqual(next.toastDurations);
    expect(useSettingsStore().expandFieldDescriptions).toBe(true);
    expect(useSettingsStore().immersiveFontDirectory).toBe('F:/fonts');
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
  it.each(['registration', 'read', 'focus'] as const)('ends %s results with the owning page', async (stage) => {
    const runtime = await import('./settings-persistence.orchestrator');
    if (stage === 'focus') await runtime.initializeSettings();
    const { windowCacheLimits } = await import('@/shared/runtime/cache-limits');
    const before = windowCacheLimits();
    let finish!: (value: unknown) => void;
    api[stage === 'registration' ? 'listen' : 'read'].mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = stage === 'focus' ? Promise.resolve() : runtime.initializeSettings();
    const ended = stage === 'focus' ? pending : expect(pending).rejects.toMatchObject({ code: 'query.invalidated' });
    if (stage === 'focus') window.dispatchEvent(new Event('focus'));
    await flushPromises();
    window.dispatchEvent(new Event('pagehide'));
    const later = createSettingsFixture();
    later.cacheLimits.mediaData.entries = 9;
    finish(stage === 'registration' ? api.stop : { revision: 9, value: later });
    await ended;
    await flushPromises();
    const reads = api.read.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    api.listen.mock.calls[0]![0]({ revision: 10, value: later });
    expect(api.read).toHaveBeenCalledTimes(reads);
    expect(api.stop).toHaveBeenCalledOnce();
    expect(windowCacheLimits()).toBe(before);
  });
  it.each(['registration', 'read'] as const)('cleans up a failed initial %s', async (stage) => {
    const runtime = await import('./settings-persistence.orchestrator');
    const error = new Error('initial fixture');
    api[stage === 'registration' ? 'listen' : 'read'].mockRejectedValueOnce(error);
    await expect(runtime.initializeSettings()).rejects.toBe(error);
    const reads = api.read.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    expect(api.read).toHaveBeenCalledTimes(reads);
    expect(api.stop).toHaveBeenCalledTimes(stage === 'read' ? 1 : 0);
  });
  it.each(['read', 'focus'] as const)('does not report late %s failures from a released page', async (stage) => {
    const runtime = await import('./settings-persistence.orchestrator');
    if (stage === 'focus') await runtime.initializeSettings();
    const { recordLogBestEffort } = await import('@/services/app-log.service');
    let fail!: (error: Error) => void;
    api.read.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const pending = stage === 'focus' ? Promise.resolve() : runtime.initializeSettings();
    const ended = pending.catch(() => {});
    if (stage === 'focus') window.dispatchEvent(new Event('focus'));
    await flushPromises();
    window.dispatchEvent(new Event('pagehide'));
    fail(new Error('late fixture'));
    await ended;
    await flushPromises();
    expect(recordLogBestEffort).not.toHaveBeenCalled();
    expect(api.stop).toHaveBeenCalledOnce();
  });
});
