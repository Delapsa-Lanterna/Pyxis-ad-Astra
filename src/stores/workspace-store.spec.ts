import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ModOpeningFailure } from '@/shared/types';
import { useProjectStore } from './project.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';

beforeEach(() => setActivePinia(createPinia()));

describe('workspace Mod opening failures', () => {
  it('keeps the latest failure for each Mod root', () => {
    const workspace = useWorkspaceStore();
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'first'));
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'latest'));
    workspace.setModOpeningFailure(failure('D:\\mods\\b', 'other'));

    expect(workspace.modOpeningFailureList).toHaveLength(2);
    expect(workspace.modOpeningFailures.get('D:\\mods\\a')?.message).toBe('latest');
  });

  it('clears one failure or the entire runtime collection', () => {
    const workspace = useWorkspaceStore();
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'a'));
    workspace.setModOpeningFailure(failure('D:\\mods\\b', 'b'));

    workspace.clearModOpeningFailure('D:\\mods\\a');
    expect(workspace.modOpeningFailureList.map((item) => item.modRoot)).toEqual(['D:\\mods\\b']);

    workspace.clearModOpeningFailures();
    expect(workspace.hasModOpeningFailures).toBe(false);
  });

  it('keeps failures out of the persisted workspace projection', () => {
    const workspace = useWorkspaceStore();
    workspace.setModOpeningFailure(failure('D:\\mods\\a', 'a'));

    expect(workspace.toPersistedState()).toEqual({
      mods: [],
      starsectorRoot: null,
      gameMods: [],
      gameWarnings: [],
      columnWidths: {},
    });
  });
});

function failure(modRoot: string, message: string): ModOpeningFailure {
  return { modRoot, message, file: null, diagnostic: { code: 'unknown', message, location: null } };
}

describe('workspace active project projection', () => {
  it.each(['mod-overview', 'file-history', 'json-editor', 'table', 'mod-files'] as const)(
    'restores the %s view independently for each Mod',
    (view) => {
      const workspace = useWorkspaceStore();
      for (const name of ['alpha', 'beta'])
        workspace.registerMod({ modRoot: `M:/${name}`, displayName: name, version: '', status: 'ready' });
      if (view === 'mod-overview') workspace.activateModOverview('M:/alpha');
      if (view === 'file-history') workspace.activateModFileHistory('M:/alpha');
      if (view === 'json-editor') workspace.activateModJson('M:/alpha', 'mission');
      if (view === 'table') workspace.activateModTable('M:/alpha');
      if (view === 'mod-files') workspace.activateModFiles('M:/alpha');
      expect(workspace.isModView).toBe(true);
      workspace.activateModJson('M:/beta', 'skins');
      workspace.showSettings();
      expect(workspace.isModView).toBe(false);
      workspace.activateModTab('M:/alpha');
      expect(workspace.currentView).toBe(view);
      if (view === 'json-editor') expect(workspace.jsonPage).toBe('mission');
      workspace.activateModTab('M:/beta');
      expect(workspace.currentView).toBe('json-editor');
      expect(workspace.jsonPage).toBe('skins');
      workspace.removeLoadedModEntry('M:/alpha');
      workspace.registerMod({ modRoot: 'M:/alpha', displayName: 'Alpha', version: '', status: 'ready' });
      workspace.activateModTab('M:/alpha');
      expect(workspace.currentView).toBe('mod-overview');
      expect(workspace.jsonPage).toBe('mod-info');
    },
  );

  function register(sessionId: string, modRoot: string) {
    const update = sessionUpdateFixture(sessionId, modRoot);
    if (update.status !== 'ready') throw new Error('ready projection fixture');
    useProjectStore().registerProjectManifest(update.projection.manifest);
    return update.projection.manifest;
  }
  it('derives the selected manifest as it becomes available and follows session and projection replacement', () => {
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    workspace.registerMod({ modRoot: 'M:/alpha', displayName: 'Alpha', version: '', status: 'loading' });
    workspace.activateModOverview('M:/alpha');
    expect(workspace.activeManifest).toBeNull();
    expect(workspace.activeSessionId).toBeNull();
    const initial = register('first', 'M:/alpha');
    expect(workspace.activeManifest).toBe(project.getManifest('M:/alpha'));
    expect(workspace.activeSessionId).toBe('first');
    project.replaceProjectManifest({ ...initial, modInfo: { name: 'updated' } }, 2);
    project.replaceProjectManifest(initial, 1);
    expect(workspace.activeManifest?.modInfo?.name).toBe('updated');
    register('second', 'M:/alpha');
    project.replaceProjectManifest(initial, 3);
    expect(workspace.activeSessionId).toBe('second');
    project.removeProjectManifest('M:/alpha');
    expect(workspace.activeManifest).toBeNull();
    expect(workspace.activeSessionId).toBeNull();
  });
  it('switches and removes selections while retaining other project manifests', () => {
    const workspace = useWorkspaceStore();
    for (const name of ['alpha', 'beta']) {
      workspace.registerMod({ modRoot: `M:/${name}`, displayName: name, version: '', status: 'ready' });
      register(name, `M:/${name}`);
    }
    workspace.activateModOverview('M:/alpha');
    expect(workspace.activeSessionId).toBe('alpha');
    workspace.activateModFiles('M:/beta');
    expect(workspace.activeSessionId).toBe('beta');
    workspace.removeLoadedModEntry('M:/alpha');
    expect(workspace.activeSessionId).toBe('beta');
    workspace.showSettings();
    expect(workspace.activeSessionId).toBe('beta');
    workspace.removeLoadedModEntry('M:/beta');
    expect(workspace.activeManifest).toBeNull();
    expect(useProjectStore().manifests.size).toBe(2);
  });
  it('keeps active selection and its projection within one window', () => {
    const first = useWorkspaceStore();
    first.registerMod({ modRoot: 'M:/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    register('first', 'M:/alpha');
    first.activateModOverview('M:/alpha');
    setActivePinia(createPinia());
    const second = useWorkspaceStore();
    expect(second.activeModRoot).toBeNull();
    expect(second.activeManifest).toBeNull();
    register('second', 'M:/alpha');
    expect(first.activeSessionId).toBe('first');
    expect(second.activeSessionId).toBeNull();
  });
});
