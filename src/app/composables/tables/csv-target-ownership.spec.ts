import { csvTableIndex } from '@/test/csv-row';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvTableViewModel } from './use-csv-table-view-model';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { sessionUpdateFixture } from '@/test/write-result';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { TABLE_KEYS, type CsvTableTarget, type CsvTableIndex } from '@/shared/types';
import { csvColumnSchemasForTable } from '@/domain/tables/csv-column-schema';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  rows: vi.fn(),
  error: vi.fn(),
  choose: vi.fn<() => Promise<string | null>>(async () => null),
}));
vi.mock('@/services/csv-table.service', () => ({
  queryTableIndex: mocks.query,
  queryTableRows: mocks.rows,
  querySourceOptionCatalog: async () => [],
  queryTableRowPreviewDataUrl: async () => '',
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error, choose: mocks.choose }) }));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: async () => [] }));
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
function harness(saveBeforeSearch = async () => true) {
  let vm!: ReturnType<typeof useCsvTableViewModel>;
  wrapper = mount({
    setup() {
      vm = useCsvTableViewModel(saveBeforeSearch);
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
    if (update.status !== 'ready') throw new Error('fixture projection is ready');
    update.projection.manifest.tableSummaries.ships.header = ['id', 'name'];
    update.projection.manifest.tableSummaries.ships.totalRows = 1;
    useWorkspaceStore().registerMod({ modRoot: target.modRoot, displayName: target.sessionId, version: '', status: 'ready' });
    useProjectStore().registerProjectManifest(update.projection.manifest);
    useTablesStore().initializeModTables({
      sessionId: update.projection.manifest.sessionId,
      modRoot: target.modRoot,
      manifest: update.projection.manifest,
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
    const tables = useTablesStore();
    const target = { ...a, table };
    const keys = csvColumnSchemasForTable(table).map((schema) => schema.key);
    const header = ['custom-z', ...keys.toReversed(), 'custom-a'];
    const record = csvTableIndex([{ rowKey: 'ordered', isComment: false, data: Object.fromEntries(header.map((key) => [key, ''])) }], {
      table,
      header,
    });
    navigateToModTable(a.modRoot, table);
    tables.applyTableIndex(target, record);
    expect(tables.visibleColumns).toEqual([...keys, 'custom-z', 'custom-a']);
    expect(tables.currentHeader).toEqual(header);
    tables.applyTableIndex(target, { ...record, header: [] });
    expect(tables.visibleColumns).toEqual([...keys, 'custom-z', 'custom-a']);
  });
  async function orderedHarness(save = async () => true) {
    const record = windowRecord();
    record.totalRows = 2;
    record.rowKeys.push('second');
    record.rows.push({ ...record.rows[0]!, rowKey: 'second', data: { id: 'second' } });
    mocks.query.mockResolvedValue(record);
    const vm = harness(save);
    await flushPromises();
    useTablesStore().moveRow(a, 'second', 0);
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
    const tables = useTablesStore();
    tables.moveRow(a, 'row-400', 0);
    tables.updateCellValue({ ...a, rowKey: 'row-0', column: 'id' }, 'local');
    await vm.loadTableWindow(240, 80);
    expect(mocks.rows).toHaveBeenLastCalledWith(
      a.sessionId,
      'ships',
      Array.from({ length: 79 }, (_, index) => 'row-' + (240 + index)),
      expect.any(AbortSignal),
    );
    expect(tables.rows[0]?.rowKey).toBe('row-400');
    expect(tables.rows[1]?.data.id).toBe('local');
    expect(tables.rows[241]?.rowKey).toBe('row-240');
    expect(tables.hasCurrentTableExternalUpdate).toBe(false);
  });
  it.each(['save', 'discard', null])('settles the complete ordered draft using %s before searching', async (choice) => {
    const tables = useTablesStore();
    const save = vi.fn(async () => {
      tables.markTableSavedForMod(a.modRoot, a.table);
      return true;
    });
    const vm = await orderedHarness(save);
    tables.updateCellValue({ ...a, rowKey: 'row', column: 'name' }, 'draft');
    mocks.choose.mockResolvedValueOnce(choice);
    await vm.setSearchText('second');
    await flushPromises();
    expect(mocks.choose).toHaveBeenCalledOnce();
    if (choice === null) {
      expect(tables.searchText).toBe('');
      expect(tables.hasCurrentRowOrderChanges).toBe(true);
      expect(tables.rows.find((row) => row?.rowKey === 'row')?.data.name).toBe('draft');
    } else {
      expect(tables.searchText).toBe('second');
      expect(tables.hasCurrentTableChanges).toBe(false);
      expect(vm.reorderDisabledReason.value).toBe('清空搜索和筛选后可调整行序');
    }
    expect(save).toHaveBeenCalledTimes(choice === 'save' ? 1 : 0);
  });
  it('keeps an ordered draft when saving is cancelled and allows an empty search-field selection', async () => {
    const vm = await orderedHarness(async () => false);
    await vm.setSearchField('name');
    await vm.setSearchText('   ');
    await flushPromises();
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(vm.reorderDisabledReason.value).toBe('');
    mocks.choose.mockResolvedValueOnce('save');
    await vm.setSearchText('value');
    await flushPromises();
    expect(useTablesStore().searchText).toBe('   ');
    expect(useTablesStore().hasCurrentRowOrderChanges).toBe(true);
  });
  it('owns a single search intent and revokes it across an A-B-A target handoff', async () => {
    const vm = await orderedHarness();
    let finish!: (choice: string) => void;
    mocks.choose.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const searching = vm.setSearchText('first');
    await flushPromises();
    await vm.setSearchText('second');
    expect(mocks.choose).toHaveBeenCalledOnce();
    navigateToModTable(b.modRoot, 'ships');
    await flushPromises();
    navigateToModTable(a.modRoot, 'ships');
    await flushPromises();
    finish('discard');
    await searching;
    await flushPromises();
    expect(useTablesStore().searchText).toBe('');
    expect(useTablesStore().hasCurrentRowOrderChanges).toBe(true);
    expect(vm.searchPending.value).toBe(false);
  });

  it('reloads the first window with the selected search field and retains the text', async () => {
    const vm = harness();
    await flushPromises();
    const tables = useTablesStore();
    await vm.setSearchText('Alpha');
    await flushPromises();
    await vm.setSearchField('name');
    await flushPromises();
    expect(tables.searchText).toBe('Alpha');
    expect(tables.searchField).toBe('name');
    expect(mocks.query).toHaveBeenLastCalledWith(a.sessionId, 'ships', 0, 'Alpha', 'name', expect.any(AbortSignal));
    navigateToModTable(a.modRoot, 'weapons');
    await flushPromises();
    expect(tables.searchText).toBe('');
    expect(tables.searchField).toBe('id-name');
  });

  it('commits the active input before changing search fields and preserves its dirty edit', async () => {
    const vm = harness();
    await flushPromises();
    const tables = useTablesStore();
    const dirty = ref(true);
    const commit = vi.fn(() => {
      expect(tables.searchField).toBe('id-name');
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
    expect(tables.searchField).toBe('name');
    expect(tables.rows[0]?.data.name).toBe('Unblurred draft');
    expect(tables.hasCurrentTableChanges).toBe(true);
    unregister();
  });

  it('retains the selected search field and original input when input commit fails', async () => {
    const vm = harness();
    await flushPromises();
    const tables = useTablesStore();
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
    expect(tables.searchField).toBe('id-name');
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
    expect(useTablesStore().rows[0]?.data.id).toBe('demo');
    expect(useTablesStore().searchField).toBe('name');
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('measures and persists prototype-named columns as ordinary header keys', async () => {
    const record = windowRecord();
    record.header = ['id', '__proto__', 'constructor'];
    record.rows[0]!.data = JSON.parse('{"id":"demo","__proto__":"value","constructor":"other"}');
    const manifest = useProjectStore().getManifest(a.modRoot)!;
    manifest.tableSummaries.ships.header = record.header;
    useTablesStore().initializeModTables({ sessionId: a.sessionId, modRoot: a.modRoot, manifest });
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
    const tables = useTablesStore();
    tables.applyTableIndex(b, windowRecord());
    if (dirty) tables.updateCellValue({ ...b, rowKey: 'row', column: 'name' }, 'B draft');
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(120);
    navigateToModTable(b.modRoot, 'ships');
    await flushPromises();
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(260);
    vm.setColumnWidth('name', 300);
    expect(useWorkspaceStore().getColumnWidths(a.modRoot, 'ships')?.name).toBe(120);
    expect(useWorkspaceStore().getColumnWidths(b.modRoot, 'ships')?.name).toBe(300);
    if (dirty) expect(tables.rows[0]?.data.name).toBe('B draft');
  });

  it('applies captured table state to its owner across workspace navigation', async () => {
    const tables = useTablesStore();
    tables.setSearchText(a, 'A search');
    tables.setSearchField(a, 'name');
    tables.selectRowByKey(a, 'A row');
    navigateToModTable(b.modRoot, 'ships');
    tables.applyTableIndex(a, windowRecord());
    tables.markTableExternalUpdate(a);
    expect(tables.searchText).toBe('');
    expect(tables.searchField).toBe('id-name');
    expect(tables.selectedRowKey).toBeNull();
    navigateToModTable(a.modRoot, 'ships');
    expect(tables.searchText).toBe('A search');
    expect(tables.searchField).toBe('name');
    expect(tables.hasCurrentTableExternalUpdate).toBe(true);
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
    expect(useTablesStore().rows[0]?.data.id).toBe('demo');
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
