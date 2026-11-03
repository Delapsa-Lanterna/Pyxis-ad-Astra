import { useWorkspaceCsvEditorHost } from '@/app/composables/use-workspace-csv-editor-host';
import { useCsvEditorModel } from './use-csv-editor-model';
import { csvEditorView } from '@/app/composables/csv-editor/tests/csv-editor-view';
import { csvTableIndex } from '@/test/fixtures/csv-row';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvTableViewModel } from './use-csv-table-view-model';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { TABLE_KEYS, type CsvTableTarget, type CsvTableIndex, type AppFeedback } from '@/shared/types';
import { csvColumnSchemasForTable } from '@/domain/csv-editor/csv-column-schema';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  rows: vi.fn(),
  error: vi.fn(),
  choose: vi.fn<AppFeedback['choose']>(async () => null),
}));
vi.mock('@/services/csv-table.service', () => ({
  queryTableIndex: mocks.query,
  queryTableRows: mocks.rows,
  querySourceOptionCatalog: async () => [],
  queryTableRowPreviewDataUrl: async () => '',
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error, choose: mocks.choose }) }));
vi.mock('@/services/source-catalog.service', () => ({ querySourceOptionCatalog: async () => [] }));
let wrapper: VueWrapper;
const a: CsvTableTarget = { sessionId: 'sA', modRoot: 'M:/A', table: 'ships' };
const b: CsvTableTarget = { sessionId: 'sB', modRoot: 'M:/B', table: 'ships' };
function windowRecord(): CsvTableIndex {
  return csvTableIndex([{ rowKey: 'row', isComment: false, data: { id: 'demo', name: 'Name' } }], {
    table: 'ships',
    baseVersions: [],
    header: ['id', 'name'],
    totalRows: 1,
  });
}
function currentCsvTarget() {
  const workspace = useWorkspaceStore(),
    modRoot = workspace.activeModRoot!;
  return { sessionId: workspace.activeSessionId!, modRoot, table: useCsvEditorStore().getCsvModState(modRoot)!.currentTab };
}
function harness() {
  let vm!: ReturnType<typeof useCsvTableViewModel>;
  wrapper = mount({
    setup() {
      const host = useWorkspaceCsvEditorHost(() => null);
      vm = useCsvTableViewModel(useCsvEditorModel(host.target), host);
      return () => null;
    },
  });
  return vm;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
  for (const target of [a, b]) {
    const update = sessionUpdateFixture(target.sessionId, target.modRoot);
    update.content.manifest.tableSummaries.ships.header = ['id', 'name'];
    update.content.manifest.tableSummaries.ships.totalRows = 1;
    useWorkspaceStore().registerMod({ modRoot: target.modRoot, displayName: target.sessionId, version: '', status: 'ready' });
    useProjectStore().registerProjectManifest(update.content.manifest);
    useCsvEditorStore().initializeModTables({
      sessionId: update.content.manifest.sessionId,
      modRoot: target.modRoot,
      manifest: update.content.manifest,
    });
  }
  useWorkspaceStore().setColumnWidths(a.modRoot, 'ships', { name: 120 });
  useWorkspaceStore().setColumnWidths(b.modRoot, 'ships', { name: 260 });
  mocks.query.mockResolvedValue(windowRecord());
  navigateToModTable(a.modRoot, 'ships');
});
afterEach(() => wrapper?.unmount());

describe('CSV explicit targets and column ownership', () => {
  it.each(TABLE_KEYS)('projects %s schema order through stored headers and inferred row keys', (table) => {
    const tables = useCsvEditorStore();
    const target = { ...a, table };
    const keys = csvColumnSchemasForTable(table).map((schema) => schema.key);
    const header = ['custom-z', ...keys.toReversed(), 'custom-a'];
    const record = csvTableIndex([{ rowKey: 'ordered', isComment: false, data: Object.fromEntries(header.map((key) => [key, ''])) }], {
      table,
      header,
    });
    navigateToModTable(a.modRoot, table);
    tables.applyTableIndex(target, record);
    expect(csvEditorView(currentCsvTarget()).visibleColumns).toEqual([...keys, 'custom-z', 'custom-a']);
    expect(csvEditorView(currentCsvTarget()).currentHeader).toEqual(header);
    tables.applyTableIndex(target, { ...record, header: [] });
    expect(csvEditorView(currentCsvTarget()).visibleColumns).toEqual([...keys, 'custom-z', 'custom-a']);
  });
  async function orderedHarness() {
    const record = windowRecord();
    record.totalRows = 2;
    record.rowKeys.push('second');
    record.rows.push({ ...record.rows[0]!, rowKey: 'second', data: { id: 'second' } });
    mocks.query.mockResolvedValue(record);
    const vm = harness();
    await flushPromises();
    useCsvEditorStore().moveRows(a, ['second'], 0);
    return vm;
  }
  it('reads the identities currently occupying the requested range after reordering', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ rowKey: 'row-' + index, isComment: false, data: { id: String(index) } }));
    mocks.query.mockResolvedValue(csvTableIndex(rows.slice(0, 240), { rowKeys: rows.map((row) => row.rowKey), totalRows: 500 }));
    mocks.rows.mockImplementation(async (_session: string, _table: string, keys: string[]) => ({
      table: 'ships',
      baseVersions: [],
      rows: keys.map((key) => rows[Number(key.slice(4))]!),
    }));
    const vm = harness();
    await flushPromises();
    await vm.loadTableWindow(400, 80);
    const tables = useCsvEditorStore();
    tables.moveRows(a, ['row-400'], 0);
    tables.updateCellValue({ ...a, rowKey: 'row-0', column: 'id' }, 'local');
    await vm.loadTableWindow(240, 80);
    expect(mocks.rows).toHaveBeenLastCalledWith(
      a.sessionId,
      'ships',
      Array.from({ length: 79 }, (_, index) => 'row-' + (240 + index)),
      expect.any(AbortSignal),
    );
    expect(csvEditorView(currentCsvTarget()).rows[0]?.rowKey).toBe('row-400');
    expect(csvEditorView(currentCsvTarget()).rows[1]?.data.id).toBe('local');
    expect(csvEditorView(currentCsvTarget()).rows[241]?.rowKey).toBe('row-240');
    expect(csvEditorView(currentCsvTarget()).hasCurrentTableExternalUpdate).toBe(false);
  });
  it('retains the complete ordered draft and its history while searching', async () => {
    const tables = useCsvEditorStore(),
      vm = await orderedHarness();
    tables.updateCellValue({ ...a, rowKey: 'row', column: 'name' }, 'draft');
    const document = tables.getCsvModState(a.modRoot)!.documents.ships,
      order = [...document.rowOrder];
    await vm.setSearchText('second');
    await flushPromises();
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(document.rowOrder).toEqual(order);
    expect(csvEditorView(currentCsvTarget()).rowsByKey.row!.data.name).toBe('draft');
    expect(csvEditorView(currentCsvTarget()).hasCurrentTableChanges).toBe(true);
    expect(tables.getTableEditor(currentCsvTarget()).canUndo.value).toBe(true);
    await vm.setSearchText('');
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).rowKeys).toEqual(order);
    expect(await tables.getTableEditor(currentCsvTarget()).undo()).toBe(true);
    expect(csvEditorView(currentCsvTarget()).rowsByKey.row!.data.name).toBe('Name');
    expect(await tables.getTableEditor(currentCsvTarget()).redo()).toBe(true);
    expect(csvEditorView(currentCsvTarget()).rowsByKey.row!.data.name).toBe('draft');
  });
  it('preserves reordering while clearing and changing a search', async () => {
    const vm = await orderedHarness();
    await vm.setSearchField('name');
    await vm.setSearchText('   ');
    await flushPromises();
    expect(vm.reorderDisabledReason.value).toBe('');
    await vm.setSearchText('value');
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).searchText).toBe('value');
    expect(csvEditorView(currentCsvTarget()).hasCurrentRowOrderChanges).toBe(true);
    expect(mocks.choose).not.toHaveBeenCalled();
  });
  it('revokes a late search index across an A-B-A target handoff', async () => {
    const vm = await orderedHarness();
    let finish!: (value: CsvTableIndex) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vm.setSearchText('first');
    await flushPromises();
    navigateToModTable(b.modRoot, 'ships');
    await flushPromises();
    navigateToModTable(a.modRoot, 'ships');
    await flushPromises();
    finish({ ...windowRecord(), rowKeys: ['obsolete'], rows: [] });
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).rowKeys).not.toContain('obsolete');
    expect(csvEditorView(currentCsvTarget()).hasCurrentRowOrderChanges).toBe(true);
    expect(vm.searchPending.value).toBe(false);
  });
  it('reloads the first window with the selected search field and retains the text', async () => {
    const vm = harness();
    await flushPromises();

    await vm.setSearchText('Alpha');
    await flushPromises();
    await vm.setSearchField('name');
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).searchText).toBe('Alpha');
    expect(csvEditorView(currentCsvTarget()).searchField).toBe('name');
    expect(mocks.query).toHaveBeenLastCalledWith(a.sessionId, 'ships', 0, 'Alpha', 'name', expect.any(AbortSignal));
    navigateToModTable(a.modRoot, 'weapons');
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).searchText).toBe('');
    expect(csvEditorView(currentCsvTarget()).searchField).toBe('id-name');
  });

  it('commits the active input before changing search fields and preserves its dirty edit', async () => {
    const vm = harness();
    await flushPromises();
    const tables = useCsvEditorStore();
    const dirty = ref(true);
    const commit = vi.fn(() => {
      expect(csvEditorView(currentCsvTarget()).searchField).toBe('id-name');
      tables.updateCellValue({ ...a, rowKey: 'row', column: 'name' }, 'Unblurred draft');
      dirty.value = false;
      return null;
    });
    const unregister = tables.getTableInputs(a.modRoot, a.table).register({
      key: 'row/name',
      label: '名称',
      dirty,
      commit,
      cancel: vi.fn(),
      focus: vi.fn(),
    });
    await vm.setSearchField('name');
    await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(csvEditorView(currentCsvTarget()).searchField).toBe('name');
    expect(csvEditorView(currentCsvTarget()).rows[0]?.data.name).toBe('Unblurred draft');
    expect(csvEditorView(currentCsvTarget()).hasCurrentTableChanges).toBe(true);
    unregister();
  });

  it('retains the selected search field and original input when input commit fails', async () => {
    const vm = harness();
    await flushPromises();
    const tables = useCsvEditorStore();
    const focus = vi.fn();
    const dirty = ref(true);
    const unregister = tables.getTableInputs(a.modRoot, a.table).register({
      key: 'row/name',
      label: '名称',
      dirty,
      commit: () => '输入错误',
      cancel: vi.fn(),
      focus,
    });
    const calls = mocks.query.mock.calls.length;
    await vm.setSearchField('tags');
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).searchField).toBe('id-name');
    expect(dirty.value).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(calls);
    unregister();
  });

  it.each(['resolve', 'reject'] as const)('revokes a previous search-field request on late %s', async (completion) => {
    let resolve!: (window: CsvTableIndex) => void;
    let reject!: (error: Error) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    const vm = harness();
    await vm.setSearchField('name');
    await flushPromises();
    if (completion === 'resolve') resolve({ ...windowRecord(), rows: [{ ...windowRecord().rows[0]!, data: { id: 'obsolete' } }] });
    else reject(new Error('obsolete search'));
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).rows[0]?.data.id).toBe('demo');
    expect(csvEditorView(currentCsvTarget()).searchField).toBe('name');
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('measures and persists prototype-named columns as ordinary header keys', async () => {
    const record = windowRecord();
    record.header = ['id', '__proto__', 'constructor'];
    record.rows[0]!.data = JSON.parse('{"id":"demo","__proto__":"value","constructor":"other"}');
    const manifest = useProjectStore().getManifest(a.modRoot)!;
    manifest.tableSummaries.ships.header = record.header;
    useCsvEditorStore().initializeModTables({ sessionId: a.sessionId, modRoot: a.modRoot, manifest });
    mocks.query.mockResolvedValue(record);
    const vm = harness();
    await flushPromises();
    expect(vm.effectiveColumns.value.every((column) => Number.isFinite(column.widthPx))).toBe(true);
    vm.setColumnWidth('__proto__', 190);
    expect(vm.effectiveColumns.value.find((column) => column.key === '__proto__')?.widthPx).toBe(190);
    expect(useWorkspaceStore().getColumnWidths(a.modRoot, a.table)?.['__proto__']).toBe(190);
    expect(Number.isFinite(vm.effectiveTotalWidthPx.value)).toBe(true);
  });
  it.each([false, true])('loads the destination widths before handling its dirty=%s state', async (dirty) => {
    const vm = harness();
    await flushPromises();
    const tables = useCsvEditorStore();
    tables.applyTableIndex(b, windowRecord());
    if (dirty) tables.updateCellValue({ ...b, rowKey: 'row', column: 'name' }, 'B draft');
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(120);
    navigateToModTable(b.modRoot, 'ships');
    await flushPromises();
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(260);
    vm.setColumnWidth('name', 300);
    expect(useWorkspaceStore().getColumnWidths(a.modRoot, 'ships')?.name).toBe(120);
    expect(useWorkspaceStore().getColumnWidths(b.modRoot, 'ships')?.name).toBe(300);
    if (dirty) expect(csvEditorView(currentCsvTarget()).rows[0]?.data.name).toBe('B draft');
  });

  it('applies captured table state to its owner across workspace navigation', async () => {
    const tables = useCsvEditorStore();
    tables.setSearchText(a, 'A search');
    tables.setSearchField(a, 'name');
    tables.selectRowByKey(a, 'A row');
    navigateToModTable(b.modRoot, 'ships');
    tables.applyTableIndex(a, windowRecord());
    tables.markTableExternalUpdate(a);
    expect(csvEditorView(currentCsvTarget()).searchText).toBe('');
    expect(csvEditorView(currentCsvTarget()).searchField).toBe('id-name');
    expect(csvEditorView(currentCsvTarget()).selectedRowKey).toBeNull();
    navigateToModTable(a.modRoot, 'ships');
    expect(csvEditorView(currentCsvTarget()).searchText).toBe('A search');
    expect(csvEditorView(currentCsvTarget()).searchField).toBe('name');
    expect(csvEditorView(currentCsvTarget()).hasCurrentTableExternalUpdate).toBe(true);
  });

  it.each(['resolve', 'reject'] as const)('releases the prior Mod window %s after switching to a same-name table', async (completion) => {
    let resolve!: (window: CsvTableIndex) => void;
    let reject!: (error: Error) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    harness();
    navigateToModTable(b.modRoot, 'ships');
    await flushPromises();
    if (completion === 'resolve') resolve({ ...windowRecord(), rows: [{ ...windowRecord().rows[0]!, data: { id: 'old' } }] });
    else reject(new Error('Old Mod query'));
    await flushPromises();
    expect(csvEditorView(currentCsvTarget()).rows[0]?.data.id).toBe('demo');
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
