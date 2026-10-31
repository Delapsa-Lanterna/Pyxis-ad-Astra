import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { useProjectStore } from '@/stores/project.store';
import {
  closeWorkspaceRuntime,
  captureWorkspaceCloseTarget,
  acceptReleasedSessions,
  removeLoadedModRuntime,
} from './workspace-lifecycle.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
const api = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock('@/services/core-assets.service', () => ({ invalidateCoreCacheForRoot: vi.fn(async () => {}) }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
function register(id: string, modRoot = 'M:/' + id) {
  const update = sessionUpdateFixture(id, modRoot);
  useProjectStore().registerProjectManifest(update.projection.manifest);
  useWorkspaceStore().registerMod({ modRoot, displayName: id, version: '', status: 'ready' });
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
describe('workspace close results', () => {
  const external = 'A:/detached/demo',
    core = 'B:/game/starsector-core';
  function isolatedPair() {
    register('mod', external);
    register('core', core);
    api.close.mockImplementation(async (scope: import('@/shared/types').CloseScope) => ({
      status: 'closed',
      destroyedWindows: [],
      releasedSessions: scope.kind === 'sessions' ? scope.sessionIds : [],
      diagnostic: null,
    }));
    return useWorkspaceStore();
  }
  it.each(['mod', 'core', 'overview'])('closes both isolated sessions from the %s view', async (active) => {
    const workspace = isolatedPair();
    workspace.activateModOverview(active === 'mod' ? external : core);
    if (active === 'overview') workspace.showOverview();
    expect(await removeLoadedModRuntime(external, api.close)).toBe(true);
    expect(api.close).toHaveBeenCalledExactlyOnceWith({ kind: 'sessions', sessionIds: ['mod', 'core'] });
    expect(workspace.loadedModList).toEqual([]);
    expect(useProjectStore().manifests.size).toBe(0);
    expect(workspace.activeModRoot).toBeNull();
    expect(workspace.currentView).toBe('overview');
    expect(workspace.hasWorkspaceContext).toBe(false);
    expect(workspace.toPersistedState()).toEqual({ mods: [], starsectorRoot: null, gameMods: [], gameWarnings: [], columnWidths: {} });
  });
  it('retains Core until the last ordinary Mod is closed', async () => {
    const workspace = isolatedPair();
    register('other', 'C:/other');
    await removeLoadedModRuntime(external, api.close);
    expect(api.close.mock.lastCall![0]).toEqual({ kind: 'sessions', sessionIds: ['mod'] });
    expect(workspace.loadedModList.map((mod) => mod.modRoot)).toEqual([core, 'C:/other']);
    await removeLoadedModRuntime('C:/other', api.close);
    expect(api.close.mock.lastCall![0]).toEqual({ kind: 'sessions', sessionIds: ['core', 'other'] });
    expect(workspace.hasWorkspaceContext).toBe(false);
  });
  it('retains the game workspace and its Core session after removing its last Mod', async () => {
    const workspace = isolatedPair();
    workspace.setGameOverview({ starsectorRoot: 'B:/game', coreAvailable: true, modsDir: 'B:/game/mods', mods: [], warnings: [] });
    workspace.activateModOverview(core);
    await removeLoadedModRuntime(external, api.close);
    expect(api.close.mock.lastCall![0]).toEqual({ kind: 'sessions', sessionIds: ['mod'] });
    expect(workspace.loadedModList.map((mod) => mod.modRoot)).toEqual([core]);
    expect(workspace.hasGameWorkspace).toBe(true);
    expect(workspace.activeModRoot).toBe(core);
  });
  it.each(['cancelled', 'failed', 'partial'])('accepts only actual releases for an isolated %s close', async (status) => {
    const workspace = isolatedPair();
    workspace.activateModOverview(core);
    api.close.mockResolvedValue({
      status: status === 'cancelled' ? 'cancelled' : 'failed',
      destroyedWindows: [],
      releasedSessions: status === 'partial' ? ['mod'] : [],
      diagnostic: status === 'cancelled' ? null : new Error('close failed'),
    });
    const closing = removeLoadedModRuntime(external, api.close);
    if (status === 'cancelled') expect(await closing).toBe(false);
    else await expect(closing).rejects.toThrow('close failed');
    expect(api.close.mock.lastCall![0]).toEqual({ kind: 'sessions', sessionIds: ['mod', 'core'] });
    expect(workspace.loadedModList.map((mod) => mod.modRoot)).toEqual(status === 'partial' ? [core] : [external, core]);
    expect(workspace.activeModRoot).toBe(core);
  });
  it.each(['mod', 'core'])('revokes an isolated loading %s alongside the released session', async (loading) => {
    const workspace = isolatedPair(),
      root = loading === 'mod' ? external : core;
    useProjectStore().removeProjectManifest(root);
    workspace.updateModStatus(root, 'loading');
    await removeLoadedModRuntime(external, api.close);
    expect(api.close.mock.lastCall![0]).toEqual({ kind: 'sessions', sessionIds: [loading === 'mod' ? 'core' : 'mod'] });
    expect(workspace.loadedModList).toEqual([]);
    expect(workspace.getModGeneration(root)).toBeNull();
  });
  it('accepts released sessions before the final receipt and preserves other sessions', async () => {
    register('alpha');
    register('beta');
    acceptReleasedSessions(['alpha']);
    acceptReleasedSessions(['alpha']);
    expect(useProjectStore().getSessionId('M:/alpha')).toBeNull();
    expect(useProjectStore().getSessionId('M:/beta')).toBe('beta');
    expect(useWorkspaceStore().loadedModList.map((item) => item.modRoot)).toEqual(['M:/beta']);
  });
  it.each(['closed', 'cancelled', 'failed'])('cleans precisely the released sessions for %s', async (status) => {
    register('alpha');
    register('beta');
    api.close.mockResolvedValue({
      status,
      destroyedWindows: ['managed-1'],
      releasedSessions: status === 'closed' ? ['alpha', 'beta'] : ['alpha'],
      diagnostic: status === 'failed' ? new Error('native close failed') : null,
    });
    const result = closeWorkspaceRuntime(captureWorkspaceCloseTarget(), api.close);
    if (status === 'failed') await expect(result).rejects.toThrow('native close failed');
    else expect(await result).toBe(status === 'closed');
    expect(api.close).toHaveBeenCalledWith({ kind: 'sessions', sessionIds: ['alpha', 'beta'] });
    expect(useProjectStore().getSessionId('M:/alpha')).toBeNull();
    expect(useProjectStore().getSessionId('M:/beta')).toBe(status === 'closed' ? null : 'beta');
  });
});
