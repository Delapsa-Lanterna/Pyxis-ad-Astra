import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvTableViewModel } from './use-csv-table-view-model';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { csvDraftRow, csvTableIndex } from '@/test/fixtures/csv-row';
import type { CsvDraftRow, CsvTableIndex, CsvTableRowsRead } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  rows: vi.fn(),
  error: vi.fn(),
  sources: vi.fn(),
  preview: vi.fn(async () => 'preview'),
}));
vi.mock('@/services/csv-table.service', () => ({
  queryTableIndex: mocks.index,
  queryTableRows: mocks.rows,
  queryTableRowPreviewDataUrl: mocks.preview,
  hasTableInvalidation: () => false,
}));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: mocks.sources, hasSourceInvalidation: () => false }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
const target = { sessionId: 'session', modRoot: 'M:/mod', table: 'ships' as const };
let wrapper: VueWrapper, rows: CsvDraftRow[];
const versions = [{ path: 'ships.csv', fingerprint: 'base' }];
function readRows(keys: string[]): CsvTableRowsRead {
  return { table: 'ships', baseVersions: versions, rows: keys.map((key) => rows[Number(key.slice(4))]!) };
}
function harness() {
  let vm!: ReturnType<typeof useCsvTableViewModel>;
  wrapper = mount({
    setup() {
      vm = useCsvTableViewModel(async () => true);
      return () => null;
    },
  });
  return vm;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sources.mockResolvedValue([]);
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
  const manifest = sessionUpdateFixture(target.sessionId, target.modRoot).projection.manifest;
  manifest.tableSummaries.ships.header = ['id', 'name'];
  manifest.tableSummaries.ships.totalRows = 1000;
  useWorkspaceStore().registerMod({ modRoot: target.modRoot, displayName: 'Sample', version: '', status: 'ready' });
  useProjectStore().registerProjectManifest(manifest);
  useCsvEditorStore().initializeModTables({ ...target, manifest });
  useWorkspaceStore().activateModTable(target.modRoot);
  rows = Array.from({ length: 1000 }, (_, index) => csvDraftRow({ id: 'id-' + index, name: 'Name ' + index }, 'key-' + index));
  mocks.index.mockImplementation(async (_session: string, _table: string, count: number, search: string | null) => {
    const result = search ? rows.filter((row) => String(row.data.id).includes(search)) : rows;
    return csvTableIndex(result.slice(0, count), {
      totalRows: rows.length,
      rowKeys: result.map((row) => row.rowKey),
      header: ['id', 'name'],
      baseVersions: versions,
    });
  });
  mocks.rows.mockImplementation(async (_session: string, _table: string, keys: string[]) => readRows(keys));
});
afterEach(() => wrapper?.unmount());
describe('CSV index and keyed content owner', () => {
  it('locates an unloaded exact row and keeps an existing draft', async () => {
    const vm = harness();
    await flushPromises();
    vm.tables.updateCellValue({ ...target, rowKey: 'key-0', column: 'name' }, 'Local');
    useWorkspaceStore().entityLocation = { ...target, kind: 'ship', id: 'id-900', rowKey: 'key-900' };
    await flushPromises();
    expect(mocks.rows).toHaveBeenCalledWith('session', 'ships', ['key-900'], expect.any(AbortSignal));
    expect(vm.tables.selectedRowKey).toBe('key-900');
    expect(vm.tables.rowsByKey['key-900']?.data.id).toBe('id-900');
    expect(vm.tables.rowsByKey['key-0']?.data.name).toBe('Local');
    expect(useWorkspaceStore().entityLocation).toBeNull();
  });
  it.each(['selection', 'table', 'newer'] as const)('invalidates a late location after %s changes', async (reason) => {
    const vm = harness();
    await flushPromises();
    let finish!: (value: CsvTableRowsRead) => void;
    mocks.rows.mockImplementationOnce(
      () =>
        new Promise<CsvTableRowsRead>((resolve) => {
          finish = resolve;
        }),
    );
    const workspace = useWorkspaceStore();
    workspace.entityLocation = { ...target, kind: 'ship', id: 'id-900', rowKey: 'key-900' };
    await flushPromises();
    if (reason === 'selection') vm.tables.selectRowByKey(target, 'key-10');
    else if (reason === 'table') vm.tables.switchTab(target.modRoot, 'wings');
    else workspace.entityLocation = { ...target, kind: 'ship', id: 'id-800', rowKey: 'key-800' };
    await flushPromises();
    finish(readRows(['key-900']));
    await flushPromises();
    expect(vm.tables.selectedRowKey).toBe(reason === 'selection' ? 'key-10' : reason === 'newer' ? 'key-800' : null);
    expect(workspace.entityLocation).toBeNull();
  });
  it('reports a location read error through table feedback', async () => {
    harness();
    await flushPromises();
    mocks.rows.mockRejectedValueOnce(new Error('Unreadable target'));
    useWorkspaceStore().entityLocation = { ...target, kind: 'ship', id: 'id-900', rowKey: 'key-900' };
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledWith(expect.any(Error), '加载定位船体失败');
  });
  it.each(['system id', 'defense id', 'travel drive'])('loads ship-system options when %s is the only column', async (key) => {
    mocks.index.mockResolvedValue(csvTableIndex([csvDraftRow({ [key]: '' }, 'key-0')], { header: [key] }));
    mocks.sources.mockResolvedValue([{ origin: 'mod', options: [{ label: 'Sample system', value: 'sample-system' }] }]);
    const vm = harness();
    await flushPromises();
    expect(mocks.sources).toHaveBeenCalledExactlyOnceWith('session', 'csv:shipSystems.id', expect.any(AbortSignal));
    expect(vm.effectiveColumns.value[0]?.schema).toMatchObject({ control: 'reference', source: 'csv:shipSystems.id' });
    expect(vm.sourceIndex.value.optionsBySource.get('csv:shipSystems.id')?.[0]?.children).toEqual([
      expect.objectContaining({ label: 'Sample system', value: 'sample-system' }),
    ]);
  });
  it('accepts the complete index and first batch together and keeps the column model independent of row edits', async () => {
    const vm = harness();
    await flushPromises();
    const tables = useCsvEditorStore();
    expect(mocks.index).toHaveBeenCalledExactlyOnceWith('session', 'ships', 240, null, 'id-name', expect.any(AbortSignal));
    expect(vm.gridModel.value.rowKeys).toHaveLength(1000);
    expect(Object.keys(vm.gridModel.value.rowsByKey)).toHaveLength(240);
    const columns = vm.effectiveColumns.value,
      sources = vm.sourceIndex.value;
    tables.updateCellValue({ ...target, rowKey: 'key-0', column: 'name' }, 'Edited');
    expect(vm.effectiveColumns.value).toBe(columns);
    expect(vm.sourceIndex.value).toBe(sources);
    expect(vm.gridModel.value.rowsByKey['key-0']?.data.name).toBe('Edited');
  });
  it('batches missing identities with two concurrent reads and deduplicates repeated viewport requests', async () => {
    const releases: Array<() => void> = [];
    let active = 0,
      maximum = 0;
    mocks.rows.mockImplementation(
      (_session: string, _table: string, keys: string[]) =>
        new Promise<CsvTableRowsRead>((resolve) => {
          active++;
          maximum = Math.max(maximum, active);
          releases.push(() => {
            active--;
            resolve(readRows(keys));
          });
        }),
    );
    const vm = harness();
    await flushPromises();
    const loading = vm.loadTableWindow(240, 760);
    await flushPromises();
    expect(mocks.rows).toHaveBeenCalledTimes(2);
    await vm.loadTableWindow(240, 160);
    expect(mocks.rows).toHaveBeenCalledTimes(2);
    while (releases.length) {
      releases.shift()!();
      await flushPromises();
    }
    await loading;
    expect(maximum).toBe(2);
    expect(mocks.rows.mock.calls.every((call) => call[2].length <= 160)).toBe(true);
    expect(Object.keys(vm.gridModel.value.rowsByKey)).toHaveLength(1000);
  });
  it('loads the actual identities after moving an unloaded target into the viewport', async () => {
    const vm = harness();
    await flushPromises();
    useCsvEditorStore().moveRow(target, 'key-900', 0);
    await vm.loadTableWindow(0, 40);
    expect(mocks.rows).toHaveBeenLastCalledWith('session', 'ships', ['key-900'], expect.any(AbortSignal));
    expect(useCsvEditorStore().rows[0]?.rowKey).toBe('key-900');
  });
  it('accepts later content while a local field edit remains dirty against the same baseline', async () => {
    let finish!: (value: CsvTableRowsRead) => void;
    mocks.rows.mockImplementationOnce(
      () =>
        new Promise<CsvTableRowsRead>((resolve) => {
          finish = resolve;
        }),
    );
    const vm = harness();
    await flushPromises();
    const loading = vm.loadTableWindow(600, 30);
    useCsvEditorStore().updateCellValue({ ...target, rowKey: 'key-0', column: 'name' }, 'Local');
    finish(readRows(Array.from({ length: 30 }, (_, index) => 'key-' + (600 + index))));
    await loading;
    expect(vm.gridModel.value.rowsByKey['key-600']?.rowKey).toBe('key-600');
    expect(vm.gridModel.value.rowsByKey['key-0']?.data.name).toBe('Local');
    expect(useCsvEditorStore().hasCurrentTableExternalUpdate).toBe(false);
  });
  it('releases failed row requests for a later retry', async () => {
    const vm = harness();
    await flushPromises();
    mocks.rows.mockRejectedValueOnce(new Error('Unavailable'));
    await vm.loadTableWindow(600, 20);
    expect(mocks.error).toHaveBeenCalledWith(expect.any(Error), '加载表格内容失败');
    await vm.loadTableWindow(600, 20);
    expect(mocks.rows).toHaveBeenCalledTimes(2);
    expect(vm.gridModel.value.rowsByKey['key-600']).toBeDefined();
  });
  it.each(['resolve', 'reject'] as const)('revokes an earlier index %s when the baseline owner changes', async (completion) => {
    let finish!: (value: CsvTableIndex) => void, fail!: (error: Error) => void;
    mocks.index.mockImplementationOnce(
      () =>
        new Promise<CsvTableIndex>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    harness();
    useCsvEditorStore().replaceTableForMod(target.modRoot, 'ships', [csvDraftRow({ id: 'local' }, 'local')]);
    if (completion === 'resolve') finish(csvTableIndex(rows.slice(0, 2)));
    else fail(new Error('Old index'));
    await flushPromises();
    expect(useCsvEditorStore().rows[0]?.data.id).toBe('local');
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it.each(['index', 'rows'] as const)('ends a late %s read after its Mod runtime is removed', async (kind) => {
    let finishIndex!: (value: CsvTableIndex) => void;
    let finishRows!: (value: CsvTableRowsRead) => void;
    if (kind === 'index')
      mocks.index.mockImplementationOnce(
        () =>
          new Promise<CsvTableIndex>((resolve) => {
            finishIndex = resolve;
          }),
      );
    else
      mocks.rows.mockImplementationOnce(
        () =>
          new Promise<CsvTableRowsRead>((resolve) => {
            finishRows = resolve;
          }),
      );
    const vm = harness();
    await flushPromises();
    const loading = kind === 'rows' ? vm.loadTableWindow(600, 20) : Promise.resolve();
    if (kind === 'rows') await flushPromises();
    useCsvEditorStore().removeModState(target.modRoot);
    if (kind === 'index') finishIndex(csvTableIndex(rows.slice(0, 2)));
    else finishRows(readRows(Array.from({ length: 20 }, (_, index) => 'key-' + (600 + index))));
    await loading;
    await flushPromises();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(useCsvEditorStore().getCsvModState(target.modRoot)).toBeUndefined();
  });
  it('settles queued waits and rejects late row acceptance on unmount', async () => {
    let finish!: (value: CsvTableRowsRead) => void;
    mocks.rows.mockImplementation(
      () =>
        new Promise<CsvTableRowsRead>((resolve) => {
          finish = resolve;
        }),
    );
    const vm = harness();
    await flushPromises();
    const loading = vm.loadTableWindow(240, 760);
    await flushPromises();
    wrapper.unmount();
    await loading;
    finish(readRows(['key-600']));
    await flushPromises();
    expect(useCsvEditorStore().getCsvModState(target.modRoot)!.documents.ships.rows['key-600']).toBeUndefined();
    expect(mocks.rows).toHaveBeenCalledTimes(2);
  });
  it('filters identities while retaining loaded content and column widths', async () => {
    const vm = harness();
    await flushPromises();
    const first = useCsvEditorStore().rows[0],
      columns = vm.effectiveColumns.value;
    await vm.setSearchText('id-99');
    await flushPromises();
    expect(mocks.index).toHaveBeenLastCalledWith('session', 'ships', 0, 'id-99', 'id-name', expect.any(AbortSignal));
    expect(vm.gridModel.value.rowKeys).toContain('key-990');
    await vm.setSearchText('');
    await flushPromises();
    expect(useCsvEditorStore().rows[0]).toBe(first);
    expect(vm.effectiveColumns.value).toBe(columns);
  });
  it('persists independent column overrides and delegates row preview reads', async () => {
    const vm = harness();
    await flushPromises();
    vm.setColumnWidth('name', 180);
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(180);
    expect(useWorkspaceStore().getColumnWidths(target.modRoot, 'ships')?.name).toBe(180);
    useWorkspaceStore().setColumnWidths(target.modRoot, 'ships', { name: 220 });
    expect(vm.effectiveColumns.value.find((column) => column.key === 'name')?.widthPx).toBe(220);
    await expect(vm.querySelectedRowPreview({ sessionId: 'session', table: 'ships', rowKey: 'key-0' })).resolves.toBe('preview');
  });
});
