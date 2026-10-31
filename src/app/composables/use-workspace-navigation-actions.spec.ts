import { useProjectStore } from '@/stores/project.store';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openMod: vi.fn(),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
  navigation: {
    navigateToModOverview: vi.fn(),
    navigateToModFiles: vi.fn(),
    navigateToModTable: vi.fn(),
    navigateToModJson: vi.fn(),
    navigateToModFileHistory: vi.fn(),
    activateModTab: vi.fn(),
  },
}));

vi.mock('@/orchestrators/workspace-opening.orchestrator', () => ({ openWorkspaceMod: mocks.openMod }));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/orchestrators/workspace-navigation.orchestrator', () => ({
  navigateToModOverview: mocks.navigation.navigateToModOverview,
  navigateToModFiles: mocks.navigation.navigateToModFiles,
  navigateToModTable: mocks.navigation.navigateToModTable,
  navigateToModJson: mocks.navigation.navigateToModJson,
  navigateToModFileHistory: mocks.navigation.navigateToModFileHistory,
  activateModTab: mocks.navigation.activateModTab,
}));

import { useWorkspaceNavigationActions } from './use-workspace-navigation-actions';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { ref } from 'vue';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import type { ProjectManifest } from '@/shared/types';
import { TABLE_KEYS } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { gameCoreDirectoryPath } from '@/shared/lib/paths';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';

describe('useWorkspaceNavigationActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.openMod.mockResolvedValue({ type: 'mod-loaded', warnings: [] });
  });

  it('follows the effective Core root and its release', () => {
    const core = useCoreAssetsStore();
    const actions = useWorkspaceNavigationActions();
    expect(actions.coreModRoot.value).toBeNull();
    for (const root of ['D:/game', 'E:/game']) {
      core.reset(root);
      expect(actions.coreModRoot.value).toBe(gameCoreDirectoryPath(root));
    }
    core.reset(null);
    expect(actions.coreModRoot.value).toBeNull();
  });

  it.each([true, false])('uses the current project Core availability %s', (coreAvailable) => {
    const workspace = useWorkspaceStore();
    const manifest = sessionUpdateFixture('sample', 'M:/mod').projection.manifest;
    Object.assign(manifest, { starsectorRoot: 'D:/game', coreAvailable });
    useProjectStore().registerProjectManifest(manifest);
    workspace.registerMod({ modRoot: manifest.modRoot, displayName: 'Sample', version: '', status: 'ready' });
    workspace.activateModTab(manifest.modRoot);
    useCoreAssetsStore().reset('D:/game');
    expect(useWorkspaceNavigationActions().coreModRoot.value).toBe(coreAvailable ? gameCoreDirectoryPath('D:/game') : null);
  });

  it.each([true, false])('opens Core through the project flow with loaded status %s', async (loaded) => {
    useCoreAssetsStore().reset('D:/game');
    const modRoot = gameCoreDirectoryPath('D:/game');
    if (loaded) useWorkspaceStore().registerMod({ modRoot, displayName: 'Core', version: '', status: 'ready' });
    useWorkspaceNavigationActions().openCore();
    await flushPromises();
    if (loaded) expect(mocks.navigation.activateModTab).toHaveBeenCalledExactlyOnceWith(modRoot);
    else expect(mocks.openMod).toHaveBeenCalledExactlyOnceWith(modRoot, 'D:/game');
  });

  it.each([true, false])('waits for save outcome %s before opening Core', async (saved) => {
    const saving = ref(true);
    let finish!: (saved: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('sample'), modRoot: ref('M:/mod'), saving, waitForSave: () => pending });
    useCoreAssetsStore().reset('D:/game');
    useWorkspaceNavigationActions().openCore();
    expect(mocks.openMod).not.toHaveBeenCalled();
    saving.value = false;
    finish(saved);
    await flushPromises();
    expect(mocks.openMod).toHaveBeenCalledTimes(saved ? 1 : 0);
  });

  it.each([true, false])('delivers Core opening feedback for failure %s', async (failed) => {
    useCoreAssetsStore().reset('D:/game');
    const error = new Error('sample failure');
    const warning = { userMessage: 'Sample warning', diagnostic: null };
    if (failed) mocks.openMod.mockRejectedValueOnce(error);
    else mocks.openMod.mockResolvedValueOnce({ type: 'mod-loaded', warnings: [warning] });
    useWorkspaceNavigationActions().openCore();
    await flushPromises();
    if (failed) expect(mocks.feedback.error).toHaveBeenCalledExactlyOnceWith(error, '打开原版失败');
    else expect(mocks.feedback.warning).toHaveBeenCalledExactlyOnceWith(warning);
  });

  it('navigates to a mod overview through the orchestrator', () => {
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModOverview('C:/mods/alpha');
    expect(mocks.navigation.navigateToModOverview).toHaveBeenCalledWith('C:/mods/alpha');
  });

  it.each([true, false])('waits for save outcome %s and uses the latest navigation intent', async (saved) => {
    const saving = ref(true);
    let release!: (saved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('one'), modRoot: ref('M:/A'), saving, waitForSave: () => promise });
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModTable('M:/B', 'ships');
    actions.navigateToModTable('M:/C', 'weapons');
    expect(mocks.navigation.navigateToModTable).not.toHaveBeenCalled();
    saving.value = false;
    release(saved);
    await promise;
    await flushPromises();
    if (saved) expect(mocks.navigation.navigateToModTable).toHaveBeenCalledExactlyOnceWith('M:/C', 'weapons');
    else expect(mocks.navigation.navigateToModTable).not.toHaveBeenCalled();
  });

  it('routes file browsing through the same draft transition boundary', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'M:/A', displayName: 'A', version: '', status: 'ready' });
    workspace.activateModJson('M:/A', 'mod-info');
    useWorkspaceNavigationActions().navigateToModFiles('M:/A');
    expect(mocks.navigation.navigateToModFiles).toHaveBeenCalledWith('M:/A');
  });
  it('navigates to tables and mod tabs', () => {
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModTable('C:/mods/alpha', 'ships');
    actions.activateModTab('C:/mods/alpha');
    expect(mocks.navigation.navigateToModTable).toHaveBeenCalledWith('C:/mods/alpha', 'ships');
    expect(mocks.navigation.activateModTab).toHaveBeenCalledWith('C:/mods/alpha');
  });

  it('switches JSON pages through the orchestrator', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModJson('C:/mods/alpha', 'factions');
    expect(mocks.navigation.navigateToModJson).toHaveBeenCalledWith('C:/mods/alpha', 'factions');
  });

  it('navigates to file history through its explicit workspace action', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'M:/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModFileHistory('M:/alpha');
    expect(mocks.navigation.navigateToModFileHistory).toHaveBeenCalledExactlyOnceWith('M:/alpha');
    workspace.activateModFileHistory('M:/alpha');
    actions.navigateToModFileHistory('M:/alpha');
    expect(mocks.navigation.navigateToModFileHistory).toHaveBeenCalledOnce();
  });

  it('skips the confirmation and orchestrator when the target JSON page is already active', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModJson('C:/mods/alpha', 'factions');
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModJson('C:/mods/alpha', 'factions');
    expect(mocks.navigation.navigateToModJson).not.toHaveBeenCalled();
  });

  it('skips tab activation when the requested tab is already active', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    const actions = useWorkspaceNavigationActions();
    actions.activateModTab('C:/mods/alpha');
    expect(mocks.navigation.activateModTab).not.toHaveBeenCalled();
  });

  it('switches to the overview/settings/about surfaces without a mod context', () => {
    const actions = useWorkspaceNavigationActions();
    actions.showOverview();
    actions.showSettings();
    actions.showAbout();
    const workspace = useWorkspaceStore();
    expect(workspace.currentView).toBe('about');
  });

  it('retains dirty drafts while navigating away from their cached pages', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    const draftSessions = useDraftSessionsStore();
    draftSessions.registerDraftSession(ref('C:/mods/alpha'), ref(true));
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModOverview('C:/mods/alpha');
    expect(mocks.navigation.navigateToModOverview).toHaveBeenCalledWith('C:/mods/alpha');
    expect(draftSessions.hasUnsavedWorkForMod('C:/mods/alpha')).toBe(true);
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('commits the departing table input before changing the workspace target', async () => {
    const workspace = useWorkspaceStore();
    const tables = useCsvEditorStore();
    const root = 'M:/A';
    workspace.registerMod({ modRoot: root, displayName: 'A', version: '', status: 'ready' });
    const tablesManifest: ProjectManifest = {
      modRoot: root,
      baseVersions: [],
      starsectorRoot: null,
      coreAvailable: false,
      associatedSpecTables: [],
      modInfo: {},
      tableEntitySummaries: Object.fromEntries(TABLE_KEYS.map((table) => [table, 0])) as ProjectManifest['tableEntitySummaries'],
      entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
      warnings: [],
      sessionId: 'sA',
      tableSummaries: Object.fromEntries(
        TABLE_KEYS.map((table) => [table, { path: `${table}.csv`, available: table === 'ships', header: ['id'], totalRows: 0 }]),
      ) as ProjectManifest['tableSummaries'],
    };
    tables.initializeModTables({ sessionId: 'sA', modRoot: root, manifest: tablesManifest });
    useProjectStore().registerProjectManifest(tablesManifest);
    workspace.activateModTable(root);
    const dirty = ref(true);
    tables.getTableInputs(root, 'ships').register({
      key: 'row/field',
      label: 'Field',
      dirty,
      commit: () => {
        expect(mocks.navigation.navigateToModTable).not.toHaveBeenCalled();
        dirty.value = false;
        return null;
      },
      focus: vi.fn(),
      cancel: vi.fn(),
    });
    useWorkspaceNavigationActions().navigateToModTable('M:/B', 'weapons');
    await vi.waitFor(() => expect(mocks.navigation.navigateToModTable).toHaveBeenCalledWith('M:/B', 'weapons'));
    expect(dirty.value).toBe(false);
  });
});
