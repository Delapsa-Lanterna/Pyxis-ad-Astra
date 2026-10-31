import { beforeEach, describe, expect, it, vi } from 'vitest';
const requestClose = vi.fn(async (scope: import('@/shared/types').CloseScope) => ({
  status: 'closed' as const,
  destroyedWindows: [],
  releasedSessions: scope.kind === 'sessions' ? scope.sessionIds : [],
  diagnostic: null,
}));
import { createPinia, setActivePinia } from 'pinia';
import { openWorkspaceDirectory, openWorkspaceMod, openCreatedWorkspaceMod } from '@/orchestrators/workspace-opening.orchestrator';
import {
  captureWorkspaceCloseTarget,
  closeWorkspaceRuntime,
  removeLoadedModRuntime,
} from '@/orchestrators/workspace-lifecycle.orchestrator';
import { restorePersistedWorkspace } from '@/orchestrators/workspace-persistence.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import type { ProjectManifest } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  closeProject: vi.fn(async () => {}),
  initializeModTables: vi.fn(),
  loadPersistedWorkspace: vi.fn(),
  scanDirectoryGameOverview: vi.fn(),
  detectDirectoryTarget: vi.fn(),
}));

vi.mock('@/services/project-session.service', () => ({
  openProject: mocks.openProject,
  closeProject: mocks.closeProject,
}));
vi.mock('@/services/directory.service', () => ({
  detectDirectoryTarget: mocks.detectDirectoryTarget,
  scanDirectoryGameOverview: mocks.scanDirectoryGameOverview,
}));
vi.mock('@/services/core-assets.service', () => ({
  invalidateCoreCacheForRoot: vi.fn(async () => {}),
}));
vi.mock('@/services/workspace-state.service', () => ({
  loadPersistedWorkspace: mocks.loadPersistedWorkspace,
  savePersistedWorkspace: vi.fn(async () => {}),
}));
vi.mock('@/stores/csv-editor.store', () => ({
  useCsvEditorStore: () => ({ initializeModTables: mocks.initializeModTables, removeModState: vi.fn(), activateFor: vi.fn() }),
}));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));

const modRoot = 'D:/game/mods/demo';

function manifest(sessionId: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId,
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: { name: 'Demo' },
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  };
}

function pendingOpen() {
  let resolve!: (loaded: ProjectManifest) => void;
  let reject!: (error: Error) => void;
  mocks.openProject.mockReturnValueOnce(
    new Promise<ProjectManifest>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    }),
  );
  return { resolve, reject };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});

describe('workspace opening lifecycle', () => {
  it('releases a late Core session when its last isolated Mod closes', async () => {
    const external = 'A:/detached/demo',
      core = 'B:/game/starsector-core';
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: external, displayName: 'External', version: '', status: 'ready' });
    useProjectStore().registerProjectManifest({ ...manifest('external'), modRoot: external });
    const pending = pendingOpen(),
      opening = openWorkspaceMod(core, 'B:/game');
    await removeLoadedModRuntime(external, requestClose);
    expect(workspace.hasWorkspaceContext).toBe(false);
    pending.resolve({ ...manifest('late-core'), modRoot: core, starsectorRoot: 'B:/game' });
    await expect(opening).resolves.toEqual({ type: 'cancelled', modRoot: core });
    expect(mocks.closeProject).toHaveBeenCalledExactlyOnceWith('late-core');
    expect(useProjectStore().manifests.size).toBe(0);
  });
  it('closes a late session after its loading Mod is removed', async () => {
    const pending = pendingOpen();
    const opening = openWorkspaceMod(modRoot);
    await removeLoadedModRuntime(modRoot, requestClose);
    pending.resolve(manifest('stale'));
    await expect(opening).resolves.toEqual({ type: 'cancelled', modRoot });
    expect(mocks.closeProject).toHaveBeenCalledWith('stale');
    expect(useProjectStore().getManifest(modRoot)).toBeNull();
    expect(useWorkspaceStore().isModImported(modRoot)).toBe(false);
    expect(mocks.initializeModTables).not.toHaveBeenCalled();
  });

  it('cancels a directory detection that finishes after workspace close', async () => {
    let resolveDetection!: (result: unknown) => void;
    mocks.detectDirectoryTarget.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDetection = resolve;
      }),
    );
    const opening = openWorkspaceDirectory(modRoot, null);
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget(), requestClose);
    resolveDetection({ kind: 'unknown', modRoot: null, starsectorRoot: null, overview: null, warnings: [] });
    await expect(opening).resolves.toEqual({ type: 'cancelled', modRoot });
  });

  it('keeps the new opening when the previous request succeeds later', async () => {
    const pending = pendingOpen();
    const oldOpening = openWorkspaceMod(modRoot);
    await removeLoadedModRuntime(modRoot, requestClose);
    mocks.openProject.mockResolvedValueOnce(manifest('current'));
    await openWorkspaceMod(modRoot);
    pending.resolve(manifest('stale'));
    await oldOpening;
    expect(useProjectStore().getSessionId(modRoot)).toBe('current');
    expect(useWorkspaceStore().mods.get(modRoot)?.status).toBe('ready');
    expect(mocks.closeProject).toHaveBeenCalledExactlyOnceWith('stale');
    expect(mocks.initializeModTables).toHaveBeenCalledTimes(1);
  });

  it('keeps the new opening when the previous request fails later', async () => {
    const pending = pendingOpen();
    const oldOpening = openWorkspaceMod(modRoot);
    await removeLoadedModRuntime(modRoot, requestClose);
    mocks.openProject.mockResolvedValueOnce(manifest('current'));
    await openWorkspaceMod(modRoot);
    pending.reject(new Error('old opening failed'));
    await expect(oldOpening).resolves.toEqual({ type: 'cancelled', modRoot });
    expect(useProjectStore().getSessionId(modRoot)).toBe('current');
    expect(useWorkspaceStore().hasModOpeningFailures).toBe(false);
  });

  it('closes every late session after the captured workspace is closed', async () => {
    const pending = pendingOpen();
    const opening = openWorkspaceMod(modRoot);
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget(), requestClose);
    pending.resolve(manifest('stale'));
    await opening;
    expect(useWorkspaceStore().hasLoadedMods).toBe(false);
    expect(useProjectStore().manifests.size).toBe(0);
    expect(mocks.closeProject).toHaveBeenCalledWith('stale');
  });

  it('cancels restored targets removed before their session responses arrive', async () => {
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [
        { modRoot, displayName: 'Demo', version: '' },
        { modRoot: 'D:/game/mods/queued', displayName: 'Queued', version: '' },
      ],
      starsectorRoot: null,
      columnWidths: {},
    });
    const pending = pendingOpen();
    const restoring = restorePersistedWorkspace({ onModRestoreError: vi.fn() });
    await vi.waitFor(() => expect(mocks.openProject).toHaveBeenCalledTimes(1));
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget(), requestClose);
    pending.resolve(manifest('restored-stale'));
    await restoring;
    expect(useProjectStore().manifests.size).toBe(0);
    expect(mocks.initializeModTables).not.toHaveBeenCalled();
    expect(mocks.closeProject).toHaveBeenCalledWith('restored-stale');
    expect(mocks.openProject).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore().loadedModCount).toBe(0);
  });

  it('keeps the game overview closed when its restore scan completes later', async () => {
    const starsectorRoot = 'D:/game';
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [{ modRoot, displayName: 'Demo', version: '' }],
      starsectorRoot,
      gameMods: [],
      gameWarnings: [],
      columnWidths: {},
    });
    let resolveScan!: (overview: unknown) => void;
    mocks.scanDirectoryGameOverview.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    const restoring = restorePersistedWorkspace({ onModRestoreError: vi.fn() });
    await vi.waitFor(() => expect(mocks.scanDirectoryGameOverview).toHaveBeenCalledTimes(1));
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget(), requestClose);
    resolveScan({ starsectorRoot, mods: [], warnings: [] });
    await restoring;
    expect(useWorkspaceStore().gameOverview).toBeNull();
    expect(mocks.openProject).not.toHaveBeenCalled();
  });
});

describe('created Mod workspace acceptance', () => {
  it('accepts the created session through the current workspace opening', async () => {
    mocks.openProject.mockResolvedValueOnce(manifest('created'));
    await expect(openCreatedWorkspaceMod({ modRoot, starsectorRoot: null })).resolves.toEqual({ modName: 'Demo', warnings: [] });
    expect(useProjectStore().getSessionId(modRoot)).toBe('created');
    expect(mocks.initializeModTables).toHaveBeenCalledOnce();
  });
  it('closes a created session that finishes after its Mod is removed', async () => {
    const pending = pendingOpen();
    const opening = openCreatedWorkspaceMod({ modRoot, starsectorRoot: null });
    await removeLoadedModRuntime(modRoot, requestClose);
    pending.resolve(manifest('late-created'));
    await expect(opening).resolves.toBeNull();
    expect(mocks.closeProject).toHaveBeenCalledExactlyOnceWith('late-created');
    expect(mocks.initializeModTables).not.toHaveBeenCalled();
  });
  it('keeps the workspace closed after a created Mod overview scan arrives late', async () => {
    let finish!: (overview: unknown) => void;
    mocks.scanDirectoryGameOverview.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const opening = openCreatedWorkspaceMod({ modRoot, starsectorRoot: 'D:/game' });
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget(), requestClose);
    finish({ starsectorRoot: 'D:/game', mods: [], warnings: [] });
    await expect(opening).resolves.toBeNull();
    expect(useWorkspaceStore().gameOverview).toBeNull();
    expect(mocks.openProject).not.toHaveBeenCalled();
  });
  it('reports a created target already accepted by the workspace', async () => {
    mocks.openProject.mockResolvedValueOnce(manifest('existing'));
    await openWorkspaceMod(modRoot);
    await expect(openCreatedWorkspaceMod({ modRoot, starsectorRoot: null })).rejects.toMatchObject({ action: 'open-created-mod' });
    expect(mocks.openProject).toHaveBeenCalledOnce();
  });
});
