import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import type { AssociatedSpecChange, ChooseOptions } from '@/shared/types';
import { NSelect } from 'naive-ui/es/select';
import { NCheckbox } from 'naive-ui/es/checkbox';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppFeedback } from '@/shared/types';

type DirectoryOpeningOutcomeLike = Record<string, unknown> & { type: string };

const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  scanDirectoryGameOverview: vi.fn(),
  openDirectoryTarget: vi.fn(),
  openModFromOverview: vi.fn(),
  saveTableChanges: vi.fn(),
  captureWorkspaceCloseTarget: vi.fn(),
  closeWorkspaceRuntime: vi.fn(async () => true),
  removeLoadedModRuntime: vi.fn(async () => true),
  openSpecEditorWindow: vi.fn(async () => {}),
  openFileEditorWindow: vi.fn(async () => {}),
  recordLogBestEffort: vi.fn(),
  refreshProjectSourcePaths: vi.fn(),
}));

vi.mock('@/services/directory.service', () => ({
  pickDirectory: mocks.pickDirectory,
  scanDirectoryGameOverview: mocks.scanDirectoryGameOverview,
}));

vi.mock('@/orchestrators/table-save.orchestrator', () => ({
  saveTableChanges: mocks.saveTableChanges,
  pendingTableSave: () => null,
}));

vi.mock('@/orchestrators/directory-opening.orchestrator', () => ({
  openDirectoryTarget: mocks.openDirectoryTarget,
  openModFromOverview: mocks.openModFromOverview,
}));

vi.mock('@/orchestrators/workspace-lifecycle.orchestrator', () => ({
  closeWorkspaceWindows: vi.fn(async () => true),
  captureWorkspaceCloseTarget: mocks.captureWorkspaceCloseTarget,
  closeWorkspaceRuntime: mocks.closeWorkspaceRuntime,
  removeLoadedModRuntime: mocks.removeLoadedModRuntime,
}));

vi.mock('@/windows/spec-editor.window', () => ({
  openSpecEditorWindow: mocks.openSpecEditorWindow,
}));

vi.mock('@/windows/file-editor.window', () => ({
  openFileEditorWindow: mocks.openFileEditorWindow,
  openGameWarningFileEditor: vi.fn(() => null),
  openModOpeningFailureFileEditor: vi.fn(() => null),
}));

vi.mock('@/services/app-log.service', () => ({
  recordLogBestEffort: mocks.recordLogBestEffort,
}));

vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  refreshProjectSourcePaths: mocks.refreshProjectSourcePaths,
  retryPendingWritesForMod: vi.fn(),
}));
import { useWorkspaceShellActions } from './use-workspace-shell-actions';
import { useProjectStore } from '@/stores/project.store';
import type { ProjectManifest } from '@/shared/types';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
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
    expect(feedback.choose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.removeLoadedModRuntime).toHaveBeenCalledWith('M:/mod'));
    expect(feedback.success).toHaveBeenCalledWith('Mod 已从工作区移除');
  });

  it('removes a clean mod immediately without confirmation', async () => {
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.confirmRemoveMod('M:/clean');
    expect(mocks.removeLoadedModRuntime).toHaveBeenCalledWith('M:/clean');
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
    const content = (feedback.choose as ReturnType<typeof vi.fn>).mock.calls[0]![0].content;
    expect(content).toContain('未保存修改');
    await vi.waitFor(() => expect(mocks.closeWorkspaceRuntime).toHaveBeenCalledTimes(1));
    expect(feedback.success).toHaveBeenCalledWith('工作区已关闭');
  });

  it.each([true, false])('coalesces workspace closing while save completes with %s', async (saved) => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: ['M:/mod'] });
    const saving = ref(true),
      dirty = ref(false);
    let release!: (saved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('one'), modRoot: ref('M:/mod'), saving, waitForSave: () => promise });
    useDraftSessionsStore().registerDirtySource(() => dirty.value);
    const feedback = feedbackStub();
    (feedback.choose as ReturnType<typeof vi.fn>).mockResolvedValue('close');
    const actions = useWorkspaceShellActions(feedback);
    const closing = actions.confirmCloseWorkspace();
    expect(actions.confirmCloseWorkspace()).toBe(closing);
    expect(feedback.choose).not.toHaveBeenCalled();
    dirty.value = true;
    saving.value = false;
    release(saved);
    expect(await closing).toBe(saved);
    if (saved) {
      expect(feedback.choose).toHaveBeenCalledOnce();
      expect((feedback.choose as ReturnType<typeof vi.fn>).mock.calls[0]![0].content).toContain('未保存修改');
      expect(mocks.closeWorkspaceRuntime).toHaveBeenCalledOnce();
    } else {
      expect(feedback.choose).not.toHaveBeenCalled();
      expect(mocks.closeWorkspaceRuntime).not.toHaveBeenCalled();
    }
  });

  it('skips saving when there is no captured table target', async () => {
    mocks.saveTableChanges.mockResolvedValue({ status: 'noop' });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.saveChanges();
    expect(mocks.saveTableChanges).toHaveBeenCalledTimes(1);
  });
  it('returns child-window cancellation to the config-clearing caller', async () => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: [] });
    mocks.closeWorkspaceRuntime.mockResolvedValueOnce(false);
    const feedback = feedbackStub();
    vi.mocked(feedback.choose).mockResolvedValueOnce('close');
    expect(await useWorkspaceShellActions(feedback).confirmCloseWorkspace(false)).toBe(false);
    expect(feedback.success).not.toHaveBeenCalled();
  });
  it('lets configuration maintenance own the final success feedback', async () => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: [] });
    const feedback = feedbackStub();
    vi.mocked(feedback.choose).mockResolvedValueOnce('close');
    expect(await useWorkspaceShellActions(feedback).confirmCloseWorkspace(false)).toBe(true);
    expect(mocks.closeWorkspaceRuntime).toHaveBeenCalledOnce();
    expect(feedback.success).not.toHaveBeenCalled();
  });
  it('returns an explicit cancellation or failure before config clearing can proceed', async () => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: [] });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    expect(await actions.confirmCloseWorkspace(false)).toBe(false);
    vi.mocked(feedback.choose).mockResolvedValueOnce('close');
    mocks.closeWorkspaceRuntime.mockRejectedValueOnce(new Error('session close failed'));
    expect(await actions.confirmCloseWorkspace(false)).toBe(false);
    expect(feedback.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '关闭工作区失败');
  });

  it('reports the save result of the active table', async () => {
    mocks.saveTableChanges.mockResolvedValue({ status: 'saved' });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.saveChanges();
    expect(mocks.saveTableChanges).toHaveBeenCalledWith({
      table: 'ships',
      manifest: null,
      selectAssociatedSpecs: expect.any(Function),
      feedback,
    });
    expect(feedback.success).toHaveBeenCalledWith('当前 CSV 表已保存');
  });

  it('returns the adjusted weapon creation branch and selected actions from the confirmation', async () => {
    mocks.saveTableChanges.mockResolvedValue({ status: 'noop' });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.saveChanges();
    const select = mocks.saveTableChanges.mock.calls[0]![0].selectAssociatedSpecs as (
      choices: AssociatedSpecCandidate[],
    ) => Promise<AssociatedSpecChange[] | null>;
    (feedback.choose as ReturnType<typeof vi.fn>).mockImplementationOnce(async (options: ChooseOptions) => {
      const content = options.content as () => import('vue').VNode;
      const wrapper = mount({ render: content });
      try {
        expect(wrapper.text()).toContain('pulse 在原版中无法正常处理');
        wrapper.findComponent(NSelect).vm.$emit('update:value', 'beam');
        wrapper.findAllComponents(NCheckbox)[1]!.vm.$emit('update:checked', false);
        await flushPromises();
        expect(wrapper.findComponent(NSelect).props('value')).toBe('beam');
      } finally {
        wrapper.unmount();
      }
      return 'save';
    });
    const chosen = await select([
      {
        key: 'create',
        table: 'weapons',
        label: '创建武器',
        change: { action: 'create', create: { kind: 'weapon', id: 'weapon', specClass: 'projectile' } },
      },
      { key: 'delete', table: 'weapons', label: '删除武器', change: { action: 'delete', id: 'old' } },
    ]);
    expect(chosen).toEqual([{ action: 'create', create: { kind: 'weapon', id: 'weapon', specClass: 'beam' } }]);
  });

  it('informs when there is nothing to save', async () => {
    mocks.saveTableChanges.mockResolvedValue({ status: 'noop' });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.saveChanges();
    expect(feedback.info).toHaveBeenCalledWith('没有需要保存的修改');
  });

  it('reports undo and redo failures for the current table', () => {
    vi.doMock('@/stores/tables.store', () => ({
      useTablesStore: () => ({ undoCurrentTableEdit: () => null, redoCurrentTableEdit: () => null }),
    }));
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    actions.undoCurrentTableEdit();
    actions.redoCurrentTableEdit();
    expect(feedback.error).toHaveBeenCalledWith('撤销 CSV 编辑失败');
    expect(feedback.error).toHaveBeenCalledWith('重做 CSV 编辑失败');
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
      useProjectStore().replaceProjectManifest({ ...manifest, modInfo: { name: 'After', version: '2' } }, 1);
    });
    await actions.refreshModOverview(manifest.modRoot);
    expect(mocks.refreshProjectSourcePaths).toHaveBeenCalledWith('s1', manifest.modRoot, [
      manifest.modRoot + '/mod_info.json',
      manifest.modRoot + '/data',
    ]);
    expect(workspace.activeMod).toMatchObject({ displayName: 'After', version: '2' });
    workspace.activateModConfig(manifest.modRoot, 'file-history');
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
    useProjectStore().replaceProjectManifest({ ...manifest, modInfo: { name: 'After', version: '2' } }, 1);
    finish();
    await pending;
    expect(useWorkspaceStore().loadedModList[0]).toMatchObject(
      dispose ? { displayName: 'Before', version: '1' } : { displayName: 'After', version: '2' },
    );
  });
  it('reports a loaded-session refresh failure and retains its current entry', async () => {
    registerOverview('C:/mods/alpha', 's1');
    const feedback = feedbackStub();
    mocks.refreshProjectSourcePaths.mockRejectedValueOnce(new Error('read failed'));
    await useWorkspaceShellActions(feedback).refreshWorkspace();
    expect(feedback.error).toHaveBeenCalledWith(expect.any(Error), '刷新工作区失败');
    expect(useWorkspaceStore().loadedModList[0]!.displayName).toBe('Before');
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
    await actions.refreshWorkspace();
    expect(mocks.scanDirectoryGameOverview).toHaveBeenCalledWith('D:/games/starsector');
    expect(feedback.success).toHaveBeenCalledWith(expect.stringContaining('1 个 Mod'));
  });
});
