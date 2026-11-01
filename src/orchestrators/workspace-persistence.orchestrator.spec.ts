import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedWorkspace, ProjectManifest, WorkspaceView } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  loadPersistedWorkspace: vi.fn(),
  savePersistedWorkspace: vi.fn(async () => {}),
  scanDirectoryGameOverview: vi.fn(),
  loadWorkspaceModManifest: vi.fn(),
  initializeWorkspaceModRuntime: vi.fn(),
}));

vi.mock('@/services/workspace-state.service', () => ({
  loadPersistedWorkspace: mocks.loadPersistedWorkspace,
  savePersistedWorkspace: mocks.savePersistedWorkspace,
}));

vi.mock('@/services/directory.service', () => ({
  scanDirectoryGameOverview: mocks.scanDirectoryGameOverview,
}));

vi.mock('@/orchestrators/workspace-opening.orchestrator', () => ({
  loadWorkspaceModManifest: mocks.loadWorkspaceModManifest,
  initializeWorkspaceModRuntime: mocks.initializeWorkspaceModRuntime,
}));

import {
  restorePersistedWorkspace,
  watchWorkspacePersistence,
  beginWorkspaceRestore,
  finishWorkspaceRestore,
} from './workspace-persistence.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';

function manifestFixture(modRoot: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId: 's1',
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: { name: 'Alpha', version: '1.0' },
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [{ code: 'scan.warning', location: null, path: 'data/x.csv', message: 'scan warning', editTarget: null }],
  };
}

describe('restorePersistedWorkspace', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('returns early for an empty persisted snapshot', async () => {
    mocks.loadPersistedWorkspace.mockResolvedValue({ mods: [], starsectorRoot: null });
    await restorePersistedWorkspace({ onModRestoreError: vi.fn() });
    expect(mocks.scanDirectoryGameOverview).not.toHaveBeenCalled();
    expect(mocks.loadWorkspaceModManifest).not.toHaveBeenCalled();
    expect(mocks.initializeWorkspaceModRuntime).not.toHaveBeenCalled();
  });

  it.each(['D:/games/starsector/starsector-core', '\\\\?\\D:\\games\\starsector\\STARSECTOR-CORE\\'])(
    'finishes an unattached Core snapshot as an empty workspace: %s',
    async (modRoot) => {
      mocks.loadPersistedWorkspace.mockResolvedValue({
        mods: [{ modRoot, displayName: 'Core', version: '' }],
        starsectorRoot: null,
        gameMods: [],
        gameWarnings: [],
        columnWidths: { [modRoot]: { ships: { id: 120 } } },
      });
      beginWorkspaceRestore();
      await restorePersistedWorkspace({ onModRestoreError: vi.fn() });
      expect(useWorkspaceStore().hasWorkspaceContext).toBe(false);
      expect(useWorkspaceStore().activeModRoot).toBeNull();
      expect(mocks.loadWorkspaceModManifest).not.toHaveBeenCalled();
      expect(mocks.scanDirectoryGameOverview).not.toHaveBeenCalled();
      await finishWorkspaceRestore();
      expect(mocks.savePersistedWorkspace).toHaveBeenCalledExactlyOnceWith({
        mods: [],
        starsectorRoot: null,
        gameMods: [],
        gameWarnings: [],
        columnWidths: {},
      });
    },
  );

  it('restores Core together with an isolated ordinary Mod', async () => {
    const roots = ['D:/game/starsector-core', 'A:/detached/demo'];
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: roots.map((modRoot) => ({ modRoot, displayName: modRoot, version: '' })),
      starsectorRoot: null,
      gameMods: [],
      gameWarnings: [],
      columnWidths: {},
    });
    mocks.loadWorkspaceModManifest.mockImplementation(async (root: string) => manifestFixture(root));
    await restorePersistedWorkspace({ onModRestoreError: vi.fn() });
    expect(useWorkspaceStore().loadedModList.map((mod) => mod.modRoot)).toEqual(roots);
    expect(mocks.loadWorkspaceModManifest).toHaveBeenCalledTimes(2);
    expect(mocks.initializeWorkspaceModRuntime).toHaveBeenCalledTimes(2);
  });

  it.each(['C:/mods/alpha', 'D:/games/starsector/starsector-core'])('restores project %s and reports load warnings', async (modRoot) => {
    const workspace = useWorkspaceStore();
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [{ modRoot, displayName: 'Alpha Folder', version: '0.9' }],
      starsectorRoot: 'D:/games/starsector',
    });
    mocks.scanDirectoryGameOverview.mockResolvedValue({ starsectorRoot: 'D:/games/starsector', mods: [] });
    mocks.loadWorkspaceModManifest.mockResolvedValue(manifestFixture(modRoot));
    const onWarnings = vi.fn();
    const onError = vi.fn();

    await restorePersistedWorkspace({ onModRestoreError: onError, onModRestoreWarnings: onWarnings });
    expect(mocks.loadWorkspaceModManifest).toHaveBeenCalledWith(
      modRoot,
      'D:/games/starsector',
      workspace.getModGeneration(modRoot),
      expect.any(Function),
    );
    expect(mocks.initializeWorkspaceModRuntime).toHaveBeenCalledWith(modRoot, expect.anything(), false);
    expect(onWarnings).toHaveBeenCalledWith('Alpha', [
      expect.objectContaining({ userMessage: 'scan warning (data/x.csv)', diagnostic: expect.objectContaining({ code: 'scan.warning' }) }),
    ]);
    expect(onError).not.toHaveBeenCalled();
    const mod = workspace.mods.get(modRoot);
    expect(mod?.displayName).toBe('Alpha');
    expect(mod?.status).toBe('ready');
    expect(workspace.currentView).toBe('overview');
  });

  it.each(
    (
      ['overview', 'settings', 'about', 'mod-overview', 'table', 'file-history', 'json-editor', 'mod-files'] satisfies WorkspaceView[]
    ).flatMap((view) => (['scan', 'mod'] as const).map((phase) => ({ view, phase }))),
  )('preserves $view selected during $phase restoration', async ({ view, phase }) => {
    const workspace = useWorkspaceStore();
    const modRoot = 'C:/fixtures/navigation';
    const snapshot: PersistedWorkspace = {
      mods: [{ modRoot, displayName: 'Navigation', version: '' }],
      starsectorRoot: 'D:/fixtures/game',
      gameMods: [],
      gameWarnings: [],
      columnWidths: {},
    };
    const overview = { starsectorRoot: snapshot.starsectorRoot, mods: [], warnings: [] };
    let finishScan!: (value: typeof overview) => void;
    let finishMod!: (value: ProjectManifest) => void;
    mocks.scanDirectoryGameOverview.mockReturnValueOnce(new Promise((resolve) => (finishScan = resolve)));
    mocks.loadWorkspaceModManifest.mockReturnValueOnce(new Promise((resolve) => (finishMod = resolve)));
    const restoring = restorePersistedWorkspace({ onModRestoreError: vi.fn() }, snapshot);
    if (phase === 'mod') {
      finishScan(overview);
      await vi.waitFor(() => expect(mocks.loadWorkspaceModManifest).toHaveBeenCalledTimes(1));
    }
    if (view !== 'overview' && view !== 'settings' && view !== 'about') workspace.activateModTab(modRoot);
    workspace.currentView = view;
    if (phase === 'scan') {
      finishScan(overview);
      await vi.waitFor(() => expect(mocks.loadWorkspaceModManifest).toHaveBeenCalledTimes(1));
      expect(workspace.currentView).toBe(view);
    }
    const activeModRoot = workspace.activeModRoot;
    finishMod(manifestFixture(modRoot));
    await restoring;
    expect(workspace.currentView).toBe(view);
    expect(workspace.activeModRoot).toBe(activeModRoot);
    expect(workspace.mods.get(modRoot)?.status).toBe('ready');
    expect(workspace.gameOverview).toEqual(overview);
    expect(mocks.scanDirectoryGameOverview).toHaveBeenCalledTimes(1);
    expect(mocks.loadWorkspaceModManifest).toHaveBeenCalledTimes(1);
    expect(mocks.initializeWorkspaceModRuntime).toHaveBeenCalledTimes(1);
  });

  it.each(['overview', 'settings', 'about'] as const)('preserves $0 while accepting the persisted snapshot', async (view) => {
    const workspace = useWorkspaceStore();
    let finishSnapshot!: (value: PersistedWorkspace) => void;
    mocks.loadPersistedWorkspace.mockReturnValueOnce(new Promise((resolve) => (finishSnapshot = resolve)));
    mocks.loadWorkspaceModManifest.mockResolvedValueOnce(manifestFixture('C:/fixtures/navigation'));
    const restoring = restorePersistedWorkspace({ onModRestoreError: vi.fn() });
    workspace.currentView = view;
    finishSnapshot({
      mods: [{ modRoot: 'C:/fixtures/navigation', displayName: 'Navigation', version: '' }],
      starsectorRoot: null,
      gameMods: [],
      gameWarnings: [],
      columnWidths: {},
    });
    await restoring;
    expect(workspace.currentView).toBe(view);
    expect(workspace.hasWorkspaceContext).toBe(true);
    expect(workspace.loadedModCount).toBe(1);
  });

  it('routes restore failures into the error callback', async () => {
    const workspace = useWorkspaceStore();
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [{ modRoot: 'C:/mods/broken', displayName: 'Broken', version: '' }],
      starsectorRoot: null,
    });
    mocks.loadWorkspaceModManifest.mockRejectedValue(new Error('broken mod_info'));
    const onError = vi.fn(async () => {});

    await restorePersistedWorkspace({ onModRestoreError: onError });
    expect(onError).toHaveBeenCalledWith('C:/mods/broken', 'Broken', expect.anything());
    expect(workspace.mods.get('C:/mods/broken')?.status).not.toBe('ready');
  });

  it('keeps a cancelled restore target out of runtime hydration', async () => {
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [{ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '' }],
      starsectorRoot: null,
    });
    mocks.loadWorkspaceModManifest.mockResolvedValue(null);
    const onError = vi.fn();
    await restorePersistedWorkspace({ onModRestoreError: onError });
    expect(mocks.initializeWorkspaceModRuntime).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('revokes a late persisted snapshot when its owner is released', async () => {
    let finish!: (snapshot: unknown) => void;
    mocks.loadPersistedWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let active = true;
    const pending = restorePersistedWorkspace({ onModRestoreError: vi.fn(), isCurrent: () => active });
    active = false;
    finish({ mods: [{ modRoot: 'M:/late', displayName: 'Late', version: '' }], starsectorRoot: null });
    await pending;
    expect(useWorkspaceStore().mods.size).toBe(0);
    expect(mocks.loadWorkspaceModManifest).not.toHaveBeenCalled();
  });
});

describe('watchWorkspacePersistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces workspace changes into a single save', async () => {
    const workspace = useWorkspaceStore();
    const watcher = watchWorkspacePersistence();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.showSettings();
    await vi.advanceTimersByTimeAsync(200);
    workspace.showAbout();
    await vi.advanceTimersByTimeAsync(600);

    expect(mocks.savePersistedWorkspace).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('suppresses saves while a restore is in progress', async () => {
    const workspace = useWorkspaceStore();
    const watcher = watchWorkspacePersistence();
    watcher.beginRestore();
    workspace.showSettings();
    await vi.advanceTimersByTimeAsync(800);
    expect(mocks.savePersistedWorkspace).not.toHaveBeenCalled();

    await watcher.finishRestore(true);
    expect(mocks.savePersistedWorkspace).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('skips the final save when the restore failed', async () => {
    const watcher = watchWorkspacePersistence();
    await watcher.finishRestore(false);
    expect(mocks.savePersistedWorkspace).not.toHaveBeenCalled();
    watcher.stop();
  });
});
