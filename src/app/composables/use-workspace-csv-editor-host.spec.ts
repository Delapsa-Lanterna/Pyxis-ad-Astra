import { ref } from 'vue';
import { useCsvEditorModel } from './csv-editor/use-csv-editor-model';
import { csvTableIndex } from '@/test/fixtures/csv-row';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { useWorkspaceCsvEditorHost } from './use-workspace-csv-editor-host';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import type { TableDetailAction } from '@/domain/csv-editor/table-detail-actions';
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
function fixture(getConfiguredGameRoot: () => string | null = () => null) {
  const workspace = useWorkspaceStore(),
    project = useProjectStore(),
    tables = useCsvEditorStore();
  const manifest = sessionUpdateFixture('s1', 'M:/one').projection.manifest;
  workspace.registerMod({ modRoot: manifest.modRoot, displayName: 'Fixture', version: '', status: 'ready' });
  project.registerProjectManifest(manifest);
  tables.initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
  workspace.activateModTable(manifest.modRoot);
  const scope = effectScope();
  onTestFinished(() => scope.stop());
  return { workspace, project, tables, manifest, scope, host: scope.run(() => useWorkspaceCsvEditorHost(getConfiguredGameRoot))! };
}
describe('workspace CSV host', () => {
  it('projects the complete table target and ends it with runtime release', () => {
    const own = fixture();
    expect(own.host.target.value).toEqual({ sessionId: 's1', modRoot: 'M:/one', table: 'ships' });
    own.tables.switchTab('M:/one', 'wings');
    expect(own.host.target.value?.table).toBe('wings');
    own.tables.removeModState('M:/one');
    expect(own.host.target.value).toBeNull();
  });
  it('keeps column widths in the workspace and reads the same current override', () => {
    const own = fixture(),
      target = own.host.target.value!;
    own.host.setColumnWidth(target, 'name', 180);
    expect(own.workspace.getColumnWidths(target.modRoot, target.table)).toEqual({ name: 180 });
    own.workspace.setColumnWidths(target.modRoot, target.table, { name: 220 });
    expect(own.host.columnWidths.value.name).toBe(220);
    own.tables.switchTab(target.modRoot, 'weapons');
    own.host.setColumnWidth(target, 'name', 300);
    expect(own.workspace.getColumnWidths(target.modRoot, 'ships')?.name).toBe(220);
  });
  it('acknowledges only the original ship location on the matching table', () => {
    const own = fixture();
    own.workspace.entityLocation = { sessionId: 's1', modRoot: 'M:/one', kind: 'ship', id: 'first', rowKey: 'one' };
    const first = own.host.entityLocation.value!;
    own.workspace.entityLocation = { ...first, id: 'second', rowKey: 'two' };
    const next = own.host.entityLocation.value!;
    own.host.completeEntityLocation(first);
    expect(own.workspace.entityLocation).toBe(next);
    own.host.completeEntityLocation(next);
    expect(own.workspace.entityLocation).toBeNull();
  });
  it.each(['ship', 'skin', 'variant'] as const)('delivers an already resolved %s from the original wing row', (kind) => {
    const own = fixture();
    own.tables.switchTab('M:/one', 'wings');
    const state = own.tables.getCsvModState('M:/one')!;
    state.selectedRowKey = 'wing-row';
    const origin: Extract<TableDetailAction, { type: 'wing-navigation' }> = {
      type: 'wing-navigation',
      destination: 'hull',
      sessionId: 's1',
      modRoot: 'M:/one',
      id: 'wing',
      rowKey: 'wing-row',
      disabled: false,
    };
    own.host.locateWingReference(origin, { kind, id: 'resolved', ...(kind === 'ship' ? { rowKey: 'ship-row' } : {}) });
    expect(own.workspace.entityLocation).toMatchObject({ sessionId: 's1', modRoot: 'M:/one', kind, id: 'resolved' });
    expect(own.workspace.currentView).toBe(kind === 'ship' ? 'table' : 'json-editor');
  });
  it.each(['page', 'session', 'released'] as const)('ends a %s host action', (boundary) => {
    const own = fixture(),
      target = own.host.target.value!;
    if (boundary === 'page') own.workspace.showAbout();
    else if (boundary === 'session') own.project.registerProjectManifest({ ...own.manifest, sessionId: 's2' });
    else own.scope.stop();
    own.host.setColumnWidth(target, 'name', 190);
    expect(own.workspace.getColumnWidths(target.modRoot, target.table)).toBeUndefined();
  });
  it('projects and edits an explicit second Mod independently of the visible workspace', () => {
    const own = fixture(),
      manifest = sessionUpdateFixture('s-other', 'M:/other').projection.manifest,
      target = { sessionId: manifest.sessionId, modRoot: manifest.modRoot, table: 'ships' as const };
    own.project.registerProjectManifest(manifest);
    own.tables.initializeModTables({ ...target, manifest });
    const model = useCsvEditorModel(ref(target));
    own.tables.applyTableIndex(target, csvTableIndex([{ rowKey: 'other-row', isComment: false, data: { id: 'other' } }]));
    own.tables.selectRowByKey(target, 'other-row');
    own.tables.updateCellValue({ ...target, rowKey: 'other-row', column: 'id' }, 'edited');
    expect(own.workspace.activeModRoot).toBe('M:/one');
    expect(model.view.selectedRow?.id).toBe('edited');
    expect(model.view.hasCurrentTableChanges).toBe(true);
    expect(own.tables.getCsvModState('M:/one')!.selectedRowKey).toBeNull();
  });
  it('resolves the game root from project, overview and configured input in order', () => {
    const configured = ref('G:/configured'),
      own = fixture(() => configured.value);
    expect(own.host.starsectorRoot.value).toBe('G:/configured');
    configured.value = 'G:/updated';
    expect(own.host.starsectorRoot.value).toBe('G:/updated');
    own.workspace.setGameOverview(
      { starsectorRoot: 'G:/overview', coreAvailable: true, modsDir: 'G:/overview/mods', mods: [], warnings: [] },
      false,
    );
    expect(own.host.starsectorRoot.value).toBe('G:/overview');
    own.project.registerProjectManifest({ ...own.manifest, starsectorRoot: 'G:/project' });
    expect(own.host.starsectorRoot.value).toBe('G:/project');
  });
});
