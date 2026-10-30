import { createPinia, setActivePinia } from 'pinia';
import type { AppFeedback, ProjectManifest } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type DirectoryOpeningOutcomeLike = Record<string, unknown> & { type: string };

const mocks = vi.hoisted(() => ({
  requestClose: vi.fn(),
  pickDirectory: vi.fn(),
  scanDirectoryGameOverview: vi.fn(),
  openDirectoryTarget: vi.fn(),
  openModFromOverview: vi.fn(),
  captureWorkspaceCloseTarget: vi.fn(),
  closeWorkspaceRuntime: vi.fn(async () => true),
  removeLoadedModRuntime: vi.fn(async () => true),
  openFileEditorWindow: vi.fn(async () => {}),
  recordLogBestEffort: vi.fn(),
  refreshProjectSourcePaths: vi.fn(),
  refreshCoreAssets: vi.fn(),
}));

vi.mock('@/app/composables/use-window-close-state', () => ({ useWindowLifecycleActions: () => ({ requestClose: mocks.requestClose }) }));

vi.mock('@/services/directory.service', () => ({
  pickDirectory: mocks.pickDirectory,
  scanDirectoryGameOverview: mocks.scanDirectoryGameOverview,
}));

vi.mock('@/orchestrators/directory-opening.orchestrator', () => ({
  openDirectoryTarget: mocks.openDirectoryTarget,
  openModFromOverview: mocks.openModFromOverview,
  settleDirectoryOpenings: vi.fn(async () => {}),
}));

vi.mock('@/orchestrators/workspace-lifecycle.orchestrator', () => ({
  closeWorkspaceWindows: vi.fn(async (finish: () => Promise<boolean>) => finish()),
  captureWorkspaceCloseTarget: mocks.captureWorkspaceCloseTarget,
  closeWorkspaceRuntime: mocks.closeWorkspaceRuntime,
  removeLoadedModRuntime: mocks.removeLoadedModRuntime,
}));

vi.mock('@/windows/file-editor.window', () => ({
  openFileEditorWindow: mocks.openFileEditorWindow,
  openGameWarningFileEditor: vi.fn(() => null),
  openModOpeningFailureFileEditor: vi.fn(() => null),
}));

vi.mock('@/services/app-log.service', () => ({
  recordLogBestEffort: mocks.recordLogBestEffort,
}));

vi.mock('@/orchestrators/project-sync.orchestrator', () => ({
  refreshProjectSourcePaths: mocks.refreshProjectSourcePaths,
}));
vi.mock('@/orchestrators/core-assets.orchestrator', () => ({ refreshCoreAssets: mocks.refreshCoreAssets }));

import { useWorkspaceShellActions } from './use-workspace-shell-actions';
import { useProjectStore } from '@/stores/project.store';

import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { effectScope, ref } from 'vue';

function feedbackStub(): AppFeedback {
  return {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  };
}

describe('useWorkspaceShellActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    vi.clearAllMocks();
  });

  it('opens a directory and reports the game overview outcome', async () => {
    const workspace = useWorkspaceStore();
    workspace.setGameOverview({ starsectorRoot: 'D:/games/starsector', coreAvailable: true, modsDir: 'mods', mods: [], warnings: [] });
    mocks.pickDirectory.mockResolvedValue('D:/games/starsector');
    const outcome: DirectoryOpeningOutcomeLike = { type: 'game-overview', root: 'D:/games/starsector', availableModCount: 3 };
    mocks.openDirectoryTarget.mockResolvedValue(outcome);

    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();

    expect(feedback.success).toHaveBeenCalledWith(expect.stringContaining('3 个 Mod'));
    expect(feedback.error).not.toHaveBeenCalled();
  });

  it('reports unknown directories as an error', async () => {
    mocks.pickDirectory.mockResolvedValue('C:/random');
    mocks.openDirectoryTarget.mockResolvedValue({ type: 'unknown', message: '未识别该目录' });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();
    expect(feedback.error).toHaveBeenCalledWith('未识别该目录');
  });

  it('reports directory opening failures through feedback', async () => {
    mocks.pickDirectory.mockResolvedValue('C:/broken');
    mocks.openDirectoryTarget.mockRejectedValue(new Error('scan failed'));
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();
    expect(feedback.error).toHaveBeenCalledWith(expect.anything());
  });

  it('skips an empty directory pick', async () => {
    mocks.pickDirectory.mockResolvedValue(null);
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();
    expect(mocks.openDirectoryTarget).not.toHaveBeenCalled();
  });

  it('confirms removing a mod with unsaved changes and removes after confirmation', async () => {
    const draftSessions = useDraftSessionsStore();
    draftSessions.registerDraftSession(ref('M:/mod'), ref(true));
    const feedback = feedbackStub();
    (feedback.choose as ReturnType<typeof vi.fn>).mockResolvedValue('remove');
    const actions = useWorkspaceShellActions(feedback);

    await actions.confirmRemoveMod('M:/mod');
    expect(feedback.choose).toHaveBeenCalledTimes(0);
    await vi.waitFor(() => expect(mocks.removeLoadedModRuntime).toHaveBeenCalledWith('M:/mod', mocks.requestClose));
    expect(feedback.success).toHaveBeenCalledWith('Mod 已从工作区移除');
  });

  it('removes a clean mod immediately without confirmation', async () => {
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.confirmRemoveMod('M:/clean');
    expect(mocks.removeLoadedModRuntime).toHaveBeenCalledWith('M:/clean', mocks.requestClose);
    expect(feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('warns about unsaved work when closing the workspace', async () => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: ['M:/mod'] });
    const draftSessions = useDraftSessionsStore();
    draftSessions.registerDirtySource((modRoot) => modRoot === 'M:/mod');
    const feedback = feedbackStub();
    (feedback.choose as ReturnType<typeof vi.fn>).mockResolvedValue('close');
    const actions = useWorkspaceShellActions(feedback);

    expect(await actions.confirmCloseWorkspace()).toBe(true);
    expect(feedback.choose).toHaveBeenCalledTimes(0);
    await vi.waitFor(() => expect(mocks.closeWorkspaceRuntime).toHaveBeenCalledTimes(1));
    expect(feedback.success).toHaveBeenCalledWith('工作区已关闭');
  });

  it.each([true, false])('coalesces workspace closing until native coordination completes with %s', async (closed) => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: ['M:/mod'] });
    let finish!: (value: boolean) => void;
    mocks.closeWorkspaceRuntime.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const actions = useWorkspaceShellActions(feedbackStub());
    const pending = actions.confirmCloseWorkspace();
    expect(actions.confirmCloseWorkspace()).toBe(pending);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish(closed);
    expect(await pending).toBe(closed);
  });
  it('returns child-window cancellation to the workspace caller', async () => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: [] });
    mocks.closeWorkspaceRuntime.mockResolvedValueOnce(false);
    const feedback = feedbackStub();
    vi.mocked(feedback.choose).mockResolvedValueOnce('close');
    expect(await useWorkspaceShellActions(feedback).confirmCloseWorkspace()).toBe(false);
    expect(feedback.success).not.toHaveBeenCalled();
  });
  it('returns an explicit workspace-close cancellation or failure', async () => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: [] });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    mocks.closeWorkspaceRuntime.mockResolvedValueOnce(false);
    expect(await actions.confirmCloseWorkspace()).toBe(false);
    vi.mocked(feedback.choose).mockResolvedValueOnce('close');
    mocks.closeWorkspaceRuntime.mockRejectedValueOnce(new Error('session close failed'));
    expect(await actions.confirmCloseWorkspace()).toBe(false);
    expect(feedback.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '关闭工作区失败');
  });

  function registerOverview(root: string, sessionId: string) {
    const manifest: ProjectManifest = {
      sessionId,
      modRoot: root,
      baseVersions: [{ path: root + '/mod_info.json', fingerprint: 'base' }],
      modInfo: { name: 'Before', version: '1' },
      starsectorRoot: null,
      coreAvailable: false,
      associatedSpecTables: [],
      tableSummaries: {} as ProjectManifest['tableSummaries'],
      tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
      entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
      warnings: [],
    };
    useWorkspaceStore().registerMod({ modRoot: root, displayName: 'Before', version: '1', status: 'ready' });
    useProjectStore().registerProjectManifest(manifest);
    return manifest;
  }
  it('enables and refreshes the active Mod overview and card metadata', async () => {
    const manifest = registerOverview('C:/mods/alpha', 's1'),
      workspace = useWorkspaceStore();
    workspace.activateModOverview(manifest.modRoot);
    const actions = useWorkspaceShellActions(feedbackStub());
    expect(actions.canRefreshOverview.value).toBe(true);
    mocks.refreshProjectSourcePaths.mockImplementationOnce(async () => {
      useProjectStore().replaceProjectManifest({ ...manifest, modInfo: { name: 'After', version: '2' } });
    });
    await actions.refreshModOverview(manifest.modRoot);
    expect(mocks.refreshProjectSourcePaths).toHaveBeenCalledWith('s1', manifest.modRoot, [
      manifest.modRoot + '/mod_info.json',
      manifest.modRoot + '/data',
      manifest.modRoot + '/graphics',
    ]);
    expect(workspace.activeMod).toMatchObject({ displayName: 'After', version: '2' });
    workspace.activateModFileHistory(manifest.modRoot);
    expect(actions.canRefreshOverview.value).toBe(false);
  });
  it('refreshes all loaded sessions from an overview without a game root', async () => {
    registerOverview('C:/mods/alpha', 's1');
    registerOverview('C:/mods/beta', 's2');
    const actions = useWorkspaceShellActions(feedbackStub());
    expect(actions.canRefreshOverview.value).toBe(true);
    await actions.refreshWorkspace();
    expect(mocks.refreshProjectSourcePaths.mock.calls.map((args) => args[0])).toEqual(['s1', 's2']);
    expect(mocks.scanDirectoryGameOverview).not.toHaveBeenCalled();
  });
  it.each([false, true])('keeps overview refresh at the workspace lifetime with disposal: %s', async (dispose) => {
    const manifest = registerOverview('C:/mods/alpha', 's1');
    let finish!: () => void;
    mocks.refreshProjectSourcePaths.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const scope = effectScope();
    const actions = scope.run(() => useWorkspaceShellActions(feedbackStub()))!;
    const pending = actions.refreshModOverview(manifest.modRoot);
    if (dispose) scope.stop();
    else useWorkspaceStore().showSettings();
    useProjectStore().replaceProjectManifest({ ...manifest, modInfo: { name: 'After', version: '2' } });
    finish();
    await pending;
    expect(useWorkspaceStore().loadedModList[0]).toMatchObject(
      dispose ? { displayName: 'Before', version: '1' } : { displayName: 'After', version: '2' },
    );
  });
  it('reports a loaded-session refresh failure and retains its current entry', async () => {
    registerOverview('C:/mods/alpha', 's1');
    registerOverview('C:/mods/beta', 's2');
    const feedback = feedbackStub();
    mocks.refreshProjectSourcePaths.mockRejectedValueOnce(new Error('read failed'));
    await useWorkspaceShellActions(feedback).refreshWorkspace();
    expect(feedback.error).toHaveBeenCalledWith(expect.any(Error), '刷新工作区失败');
    expect(useWorkspaceStore().loadedModList[0]!.displayName).toBe('Before');
    expect(mocks.refreshProjectSourcePaths).toHaveBeenCalledTimes(1);
  });

  it('refreshes the workspace overview from the known root', async () => {
    const workspace = useWorkspaceStore();
    workspace.setGameOverview({ starsectorRoot: 'D:/games/starsector', coreAvailable: true, modsDir: 'mods', mods: [], warnings: [] });
    mocks.scanDirectoryGameOverview.mockResolvedValue({
      starsectorRoot: 'D:/games/starsector',
      coreAvailable: true,
      modsDir: 'mods',
      mods: [{ id: 'a' }],
      warnings: [],
    });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    registerOverview('M:/loaded', 'loaded');
    workspace.showSettings();
    await actions.refreshWorkspace();
    expect(mocks.scanDirectoryGameOverview).toHaveBeenCalledWith('D:/games/starsector');
    expect(feedback.success).toHaveBeenCalledWith(expect.stringContaining('1 个 Mod'));
    expect(mocks.refreshProjectSourcePaths).toHaveBeenCalledWith('loaded', 'M:/loaded', [
      'M:/loaded/mod_info.json',
      'M:/loaded/data',
      'M:/loaded/graphics',
    ]);
    expect(workspace.currentView).toBe('settings');
  });

  it('refreshes only tab metadata and preserves order, flags and the active draft', async () => {
    const a = registerOverview('M:/alpha', 'a'),
      b = registerOverview('M:/beta', 'b'),
      workspace = useWorkspaceStore();
    workspace.setModReferenceable(b.modRoot, true);
    workspace.activateModTable(a.modRoot);
    const dirty = ref(true);
    useDraftSessionsStore().registerDraftSession(ref(a.modRoot), dirty);
    mocks.refreshProjectSourcePaths.mockImplementation(async (sessionId, modRoot) => {
      useProjectStore().replaceProjectManifest({ ...useProjectStore().getManifest(modRoot)!, modInfo: { name: sessionId, version: '2' } });
    });
    await useWorkspaceShellActions(feedbackStub()).refreshTabInfo([a.modRoot, b.modRoot]);
    expect(mocks.refreshProjectSourcePaths.mock.calls).toEqual([
      ['a', a.modRoot, [a.modRoot + '/mod_info.json']],
      ['b', b.modRoot, [b.modRoot + '/mod_info.json']],
    ]);
    expect(workspace.loadedModList.map((mod) => [mod.modRoot, mod.referenceable])).toEqual([
      [a.modRoot, undefined],
      [b.modRoot, true],
    ]);
    expect([workspace.activeModRoot, workspace.currentView, dirty.value]).toEqual([a.modRoot, 'table', true]);
    expect(workspace.mods.get(b.modRoot)).toMatchObject({ displayName: 'b', version: '2' });
  });
  it.each([false, true])('refreshes only projects belonging to the selected Core root, opened=%s', async (opened) => {
    const root = 'M:/game';
    for (const [name, game] of [['a', root], ['b', root], ['other', 'M:/elsewhere'], ...(opened ? [['game/starsector-core', root]] : [])]) {
      const manifest = registerOverview('M:/' + name, name!);
      useProjectStore().replaceProjectManifest({ ...manifest, starsectorRoot: game! });
    }
    await useWorkspaceShellActions(feedbackStub()).refreshCore(root);
    expect(mocks.refreshProjectSourcePaths.mock.calls.map((args) => args[0])).toEqual(
      opened ? ['a', 'b', 'game/starsector-core'] : ['a', 'b'],
    );
    for (const args of mocks.refreshProjectSourcePaths.mock.calls)
      expect(args[3]).toEqual([
        { source: 'core', relPath: 'data' },
        { source: 'core', relPath: 'graphics' },
      ]);
    if (opened)
      expect(mocks.refreshProjectSourcePaths.mock.lastCall![2]).toEqual([
        'M:/game/starsector-core/mod_info.json',
        'M:/game/starsector-core/data',
        'M:/game/starsector-core/graphics',
      ]);
  });
  it('refreshes an unused Core root through its existing index loader', async () => {
    await useWorkspaceShellActions(feedbackStub()).refreshCore('M:/game');
    expect(mocks.refreshCoreAssets).toHaveBeenCalledExactlyOnceWith('M:/game');
  });
});
