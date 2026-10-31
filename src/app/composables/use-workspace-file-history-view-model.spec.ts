import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { mountSetup } from '@/test/unit/mount-setup';

enableAutoUnmount(afterEach);

const mocks = vi.hoisted(() => ({
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
  historyScope: vi.fn(),
  loadFileHistory: vi.fn(async () => ({
    revision: 0,
    undoStack: [] as import('@/shared/types').FileHistoryEntrySummary[],
    redoStack: [] as import('@/shared/types').FileHistoryEntrySummary[],
  })),
  replayWorkspaceFileUndo: vi.fn(),
  replayWorkspaceFileRedo: vi.fn(),
  clearSavedFileHistory: vi.fn(async () => ({ revision: 10, undoStack: [], redoStack: [] })),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));
vi.mock('@/services/file-history.service', () => ({
  loadFileHistory: mocks.loadFileHistory,
  clearSavedFileHistory: mocks.clearSavedFileHistory,
}));

vi.mock('@/orchestrators/workspace-history.orchestrator', () => ({
  replayWorkspaceFileUndo: mocks.replayWorkspaceFileUndo,
  replayWorkspaceFileRedo: mocks.replayWorkspaceFileRedo,
}));

vi.mock('@/app/composables/use-context-menu', () => ({ useContextMenuScope: mocks.historyScope }));
import { useWorkspaceFileHistoryViewModel } from './use-workspace-file-history-view-model';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ProjectManifest } from '@/shared/types';

function manifestFixture(modRoot: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId: 's1',
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: { name: 'Alpha' },
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  };
}

describe('useWorkspaceFileHistoryViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function activateHistory() {
    const root = 'C:/mods/alpha';
    useWorkspaceStore().registerMod({ modRoot: root, displayName: 'Alpha', version: '', status: 'ready' });
    useWorkspaceStore().activateModOverview(root);
    useProjectStore().registerProjectManifest(manifestFixture(root));
    const { value: vm, wrapper } = mountSetup(useWorkspaceFileHistoryViewModel);
    return { root, wrapper, vm };
  }
  it('registers history refresh and accepts authoritative stack counts', async () => {
    const { root, wrapper, vm } = activateHistory();
    await flushPromises();
    expect(mocks.historyScope.mock.calls.at(-1)![0].canRefresh()).toBe(true);
    mocks.loadFileHistory.mockResolvedValueOnce({
      revision: 3,
      undoStack: [{ id: 1, timestamp: 0, label: 'save', paths: ['a'] }],
      redoStack: [],
    });
    await mocks.historyScope.mock.calls.at(-1)![0].refresh(() => true);
    expect(vm.historyCount.value).toBe(1);
    expect(vm.canUndo.value).toBe(true);
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(3);
    wrapper.unmount();
  });
  it.each(['success', 'error', 'handoff'])('rejects a late history result after %s', async (mode) => {
    const { root, wrapper, vm } = activateHistory();
    await flushPromises();
    let finish!: () => void;
    mocks.loadFileHistory.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () => (mode === 'error' ? reject(new Error('late')) : resolve({ revision: 5, undoStack: [], redoStack: [] }));
        }),
    );
    const pending = vm.refresh();
    if (mode === 'handoff') {
      useProjectStore().registerProjectManifest({ ...manifestFixture(root), sessionId: 's2' });
      await nextTick();
    } else wrapper.unmount();
    finish();
    await pending;
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(0);
    expect(mocks.feedback.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('falls back to the unselected-mod title', () => {
    const { value: viewModel } = mountSetup(useWorkspaceFileHistoryViewModel);
    expect(viewModel.modTitle.value).toBe('未选择 Mod');
    expect(viewModel.historyCount.value).toBe(0);
    expect(viewModel.canUndo.value).toBe(false);
    expect(viewModel.canRedo.value).toBe(false);
  });

  it('exposes the mod title from the active manifest', () => {
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    project.registerProjectManifest(manifestFixture('C:/mods/alpha'));
    const { value: viewModel } = mountSetup(useWorkspaceFileHistoryViewModel);
    expect(viewModel.modTitle.value).toBe('Alpha');
  });

  it('lists undo and redo entries newest first with counts', () => {
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    project.registerProjectManifest(manifestFixture('C:/mods/alpha'));
    const fileHistory = useFileHistoryStore();
    fileHistory.applySnapshot('C:/mods/alpha', {
      revision: 2,
      undoStack: [
        { id: 1, timestamp: 1, label: 'save one', paths: ['a'] },
        { id: 2, timestamp: 2, label: 'save two', paths: ['b'] },
      ],
      redoStack: [],
    });
    const { value: viewModel } = mountSetup(useWorkspaceFileHistoryViewModel);
    expect(viewModel.historyCount.value).toBe(2);
    expect(viewModel.undoDisplayItems.value.map((entry) => entry.label)).toEqual(['save two', 'save one']);
    expect(viewModel.redoDisplayItems.value).toEqual([]);
    expect(viewModel.canUndo.value).toBe(true);
    expect(viewModel.canRedo.value).toBe(false);
  });

  it('clears the active mod stacks behind a confirmation', async () => {
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    project.registerProjectManifest(manifestFixture('C:/mods/alpha'));
    const fileHistory = useFileHistoryStore();
    fileHistory.applySnapshot('C:/mods/alpha', {
      revision: 1,
      undoStack: [{ id: 1, timestamp: 1, label: 'save one', paths: ['a'] }],
      redoStack: [],
    });
    const { value: viewModel } = mountSetup(useWorkspaceFileHistoryViewModel);
    viewModel.confirmClear();
    expect(mocks.feedback.confirmWarning).toHaveBeenCalledTimes(1);
    await mocks.feedback.confirmWarning.mock.calls[0]![0].onConfirm();
    expect(fileHistory.getHistoryStacks('C:/mods/alpha').undoStack).toHaveLength(0);
    expect(mocks.feedback.success).toHaveBeenCalledWith('文件历史已清空');
  });

  it('skips clearing when there is no active mod or nothing to clear', () => {
    const { value: viewModel } = mountSetup(useWorkspaceFileHistoryViewModel);
    viewModel.confirmClear();
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('delegates undo and redo to the replay orchestrators', async () => {
    const { value: viewModel } = mountSetup(useWorkspaceFileHistoryViewModel);
    await viewModel.undoOne();
    await viewModel.redoOne();
    expect(mocks.replayWorkspaceFileUndo).toHaveBeenCalledTimes(1);
    expect(mocks.replayWorkspaceFileRedo).toHaveBeenCalledTimes(1);
  });
});
