import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { useWorkspaceJsonEditorHost } from './use-workspace-json-editor-host';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import type { ConfigDocumentTarget } from '@/domain/json-editor/json-document-definitions';

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
function fixture() {
  const workspace = useWorkspaceStore(),
    project = useProjectStore();
  const manifest = sessionUpdateFixture('s1', 'M:/one').content.manifest;
  workspace.registerMod({ modRoot: manifest.modRoot, displayName: 'Fixture', version: '', status: 'ready' });
  project.registerProjectManifest(manifest);
  useCsvEditorStore().initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
  const scope = effectScope();
  onTestFinished(() => scope.stop());
  return { workspace, project, scope, host: scope.run(useWorkspaceJsonEditorHost)! };
}
const origin: ConfigDocumentTarget = { sessionId: 's1', modRoot: 'M:/one', kind: 'skin', id: 'skin', entity: null };
describe('workspace JSON host', () => {
  it('projects the complete current JSON target and follows renewed sessions', () => {
    const { workspace, project, host } = fixture();
    expect(host.pageTarget.value).toBeNull();
    workspace.activateModJson('M:/one', 'skins');
    expect(host.pageTarget.value).toEqual({ sessionId: 's1', modRoot: 'M:/one', page: 'skins' });
    project.registerProjectManifest({ ...project.getManifest('M:/one')!, sessionId: 's2' });
    expect(host.pageTarget.value?.sessionId).toBe('s2');
    workspace.showAbout();
    expect(host.pageTarget.value).toBeNull();
  });
  it('completes only the original location on its matching page', () => {
    const { workspace, host } = fixture();
    workspace.activateModJson('M:/one', 'skins');
    workspace.entityLocation = { sessionId: 's1', modRoot: 'M:/one', kind: 'skin', id: 'first' };
    const first = host.entityLocation.value!;
    workspace.entityLocation = { ...first, id: 'second' };
    const second = host.entityLocation.value!;
    host.completeEntityLocation(first);
    expect(workspace.entityLocation).toBe(second);
    host.completeEntityLocation(second);
    expect(workspace.entityLocation).toBeNull();
  });
  it('locates the resolved hull through the formal workspace table navigation', () => {
    const { workspace, host } = fixture();
    workspace.activateModJson('M:/one', 'skins');
    host.locateBaseHull(origin, { id: 'hull', rowKey: 'row' });
    expect(workspace.currentView).toBe('table');
    expect(useCsvEditorStore().getCsvModState('M:/one')!.currentTab).toBe('ships');
    expect(workspace.entityLocation).toEqual({ sessionId: 's1', modRoot: 'M:/one', kind: 'ship', id: 'hull', rowKey: 'row' });
  });
  it.each(['page', 'session', 'released'] as const)('ends actions from a %s host', (boundary) => {
    const { workspace, project, scope, host } = fixture();
    workspace.activateModJson('M:/one', 'skins');
    workspace.entityLocation = { sessionId: 's1', modRoot: 'M:/one', kind: 'skin', id: 'first' };
    const first = host.entityLocation.value!;
    if (boundary === 'page') workspace.showAbout();
    else if (boundary === 'session') project.registerProjectManifest({ ...project.getManifest('M:/one')!, sessionId: 's2' });
    else scope.stop();
    host.completeEntityLocation(first);
    host.locateBaseHull(origin, { id: 'hull', rowKey: 'row' });
    expect(workspace.currentView).toBe(boundary === 'page' ? 'about' : 'json-editor');
    expect(workspace.entityLocation).toBe(first);
  });
});
