import type { CsvValidationRequest } from '@/shared/types';
import type * as CsvTableServiceModule from '@/services/csv-table.service';
import type * as SourceCatalogServiceModule from '@/services/source-catalog.service';
import { useWorkspaceCsvEditorHost } from '@/app/composables/use-workspace-csv-editor-host';
import { useCsvEditorModel } from './use-csv-editor-model';
import { csvEditorView } from '@/app/composables/csv-editor/tests/csv-editor-view';
import type { AppFeedback } from '@/shared/types';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvTableViewModel } from './use-csv-table-view-model';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture, savedWriteFixture } from '@/test/fixtures/write-result';
import { dispatchProjectChangeFixture, committedChangeFixture } from '@/test/unit/project-changes';
import { csvDraftRow, csvTableIndex } from '@/test/fixtures/csv-row';
import { deepClone } from '@/shared/lib/starsector';
import { ref } from 'vue';
import type { CsvDraftRow, CsvTableIndex, CsvTableRowsRead } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  index: vi.fn<typeof CsvTableServiceModule.queryTableIndex>(),
  rows: vi.fn<typeof CsvTableServiceModule.queryTableRows>(),
  error: vi.fn(),
  choose: vi.fn<AppFeedback['choose']>(),
  sources: vi.fn<typeof SourceCatalogServiceModule.querySourceOptionCatalog>(),
  sourceAffected: vi.fn(() => false),
  preview: vi.fn(async () => 'preview'),
  affected: vi.fn(() => false),
  validation: vi.fn<typeof CsvTableServiceModule.queryCsvValidation>(),
}));
vi.mock('@/services/csv-table.service', async (importOriginal) => ({
  ...(await importOriginal<typeof CsvTableServiceModule>()),
  queryTableIndex: mocks.index,
  queryCsvValidation: mocks.validation,
  queryTableRows: mocks.rows,
  queryTableRowPreviewDataUrl: mocks.preview,
  hasTableInvalidation: mocks.affected,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', () => import('@/test/unit/project-changes'));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => 'peer' }));
vi.mock('@/services/source-catalog.service', () => ({
  querySourceOptionCatalog: mocks.sources,
  hasSourceInvalidation: mocks.sourceAffected,
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error, choose: mocks.choose }) }));
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
      const host = useWorkspaceCsvEditorHost(() => null);
      vm = useCsvTableViewModel(useCsvEditorModel(host.target), host);
      return () => null;
    },
  });
  return vm;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sources.mockResolvedValue([]);
  mocks.sourceAffected.mockReturnValue(false);
  mocks.validation.mockImplementation(async (_session: string, request: CsvValidationRequest) => ({
    complete: false,
    entities: Object.fromEntries(request.entities.map(({ kind, id }) => [kind + ':' + id, {}])),
    sources: Object.fromEntries(request.sources.map((source) => [source, []])),
    files: {},
    classes: {},
    stationData: {},
  }));
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
  const manifest = sessionUpdateFixture(target.sessionId, target.modRoot).content.manifest;
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
      validationRows: rows.map((row) => ({ rowKey: row.rowKey, isComment: row.isComment, data: { id: row.data.id! } })),
      rowKeys: result.map((row) => row.rowKey),
      header: ['id', 'name'],
      baseVersions: versions,
    });
  });
  mocks.rows.mockImplementation(async (_session: string, _table: string, keys: string[]) => readRows(keys));
});
afterEach(() => wrapper?.unmount());
describe('CSV index and keyed content owner', () => {
  it('reloads an own-table token catalog only when its column values change', async () => {
    mocks.index.mockResolvedValue(
      csvTableIndex([csvDraftRow({ id: 'one', name: 'First', tags: 'token' }, 'key-0')], { header: ['id', 'name', 'tags'] }),
    );
    mocks.sources.mockResolvedValue([
      { origin: 'mod', options: [{ label: 'Token', value: 'token', description: null, resourceRef: null, origin: 'mod' }] },
    ]);
    harness();
    await flushPromises();
    const calls = mocks.sources.mock.calls.length;
    const event = committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot);
    event.result.sessionUpdates[0]!.content.invalidation.resources = [{ source: 'mod', relPath: 'ships.csv' }];
    mocks.affected.mockReturnValue(true);
    mocks.sourceAffected.mockReturnValue(true);
    mocks.index.mockResolvedValue(
      csvTableIndex([csvDraftRow({ id: 'one', name: 'Changed', tags: 'token' }, 'key-0')], {
        header: ['id', 'name', 'tags'],
        baseVersions: [{ path: 'ships.csv', fingerprint: 'second' }],
      }),
    );
    await dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
    expect(mocks.sources).toHaveBeenCalledTimes(calls);
    mocks.index.mockResolvedValue(
      csvTableIndex([csvDraftRow({ id: 'one', name: 'Changed', tags: 'new-token' }, 'key-0')], {
        header: ['id', 'name', 'tags'],
        baseVersions: [{ path: 'ships.csv', fingerprint: 'third' }],
      }),
    );
    await dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
    expect(mocks.sources.mock.calls.length).toBeGreaterThan(calls);
  });
  it('retains the column and source index when a refreshed catalog has equal options', async () => {
    mocks.index.mockResolvedValue(csvTableIndex([csvDraftRow({ 'system id': 'sample' }, 'key-0')], { header: ['system id'] }));
    mocks.sources.mockResolvedValue([
      { origin: 'mod', options: [{ label: 'Sample', value: 'sample', description: null, resourceRef: null, origin: 'mod' }] },
    ]);
    const vm = harness();
    await flushPromises();
    const columns = vm.effectiveColumns.value,
      source = vm.sourceIndex.value;
    mocks.sourceAffected.mockReturnValue(true);
    await dispatchProjectChangeFixture({
      ...committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot),
      reason: 'refresh',
    });
    expect(mocks.sources).toHaveBeenCalledTimes(2);
    expect(vm.effectiveColumns.value).toBe(columns);
    expect(vm.sourceIndex.value).toBe(source);
  });
  it('reuses validation for metadata and CSV value updates and reloads it once for a spec dependency', async () => {
    rows = rows.slice(0, 2);
    harness();
    await flushPromises();
    expect(mocks.validation).toHaveBeenCalledTimes(1);
    const event = committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot);
    await dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
    expect(mocks.validation).toHaveBeenCalledTimes(1);
    rows[0]!.data.name = 'External';
    mocks.index.mockResolvedValueOnce(
      csvTableIndex(rows, { header: ['id', 'name'], baseVersions: [{ path: 'ships.csv', fingerprint: 'updated' }] }),
    );
    mocks.affected.mockReturnValueOnce(true);
    await dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
    await flushPromises();
    expect(useCsvEditorStore().getCsvModState(target.modRoot)?.documents.ships.rows['key-0']?.data.name).toBe('External');
    expect(mocks.validation).toHaveBeenCalledTimes(1);
    event.result.sessionUpdates[0]!.content.invalidation.entities = [{ kind: 'ship', id: 'id-0' }];
    event.result.sessionUpdates[0]!.content.invalidation.resources = [{ source: 'mod', relPath: 'data/hulls/sample.ship' }];
    await dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
    expect(mocks.validation).toHaveBeenCalledTimes(2);
  });
  it('accepts a clean external baseline and releases the prior redo history', async () => {
    harness();
    await flushPromises();
    const tables = useCsvEditorStore(),
      state = tables.getCsvModState(target.modRoot)!,
      document = state.documents.ships;
    tables.updateCellValue({ ...target, rowKey: 'key-0', column: 'name' }, 'Local');
    tables.getTableEditor(target);
    await tables.getTableEditor(target).undo();
    expect(document.history.redoStack).toHaveLength(1);
    mocks.index.mockResolvedValueOnce(
      csvTableIndex([csvDraftRow({ id: 'changed', name: 'External' }, 'key-0')], {
        baseVersions: [{ path: 'ships.csv', fingerprint: 'external' }],
      }),
    );
    mocks.affected.mockReturnValueOnce(true);
    const event = committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot);
    await dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
    expect(document.rows['key-0']?.data.name).toBe('External');
    expect(document.baseVersions[0]?.fingerprint).toBe('external');
    expect(document.history.redoStack).toEqual([]);
    expect(document.externalUpdatePending).toBe(false);
  });
  it.each(['refresh', 'save'] as const)('stages a foreign %s while retaining row order, baseline and history', async (reason) => {
    rows = rows.slice(0, 2);
    harness();
    await flushPromises();
    const tables = useCsvEditorStore(),
      document = tables.getCsvModState(target.modRoot)!.documents.ships;
    tables.moveRows(target, ['key-1'], 0);
    const history = deepClone(document.history);
    rows.push(csvDraftRow({ id: 'added', name: 'Added' }, 'key-2'));
    mocks.index.mockResolvedValueOnce(csvTableIndex(rows, { baseVersions: [{ path: 'ships.csv', fingerprint: 'external' }] }));
    mocks.affected.mockReturnValueOnce(true);
    const event = committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot);
    await dispatchProjectChangeFixture({ ...event, reason, originWindowLabel: 'external' });
    expect(document.baselineRowOrder).toEqual(['key-0', 'key-1']);
    expect(document.rowOrder).toEqual(['key-1', 'key-0']);
    expect(document.baseVersions).toEqual(versions);
    expect(document.dirty).toEqual({});
    expect(document.history).toEqual(history);
    expect(document.externalUpdatePending).toBe(true);
  });
  it('stages an external version while preserving an unfinished raw input', async () => {
    harness();
    await flushPromises();
    const tables = useCsvEditorStore(),
      document = tables.getCsvModState(target.modRoot)!.documents.ships;
    const dirty = ref(true),
      cancel = vi.fn();
    const release = tables
      .getTableInputs(target.modRoot, target.table)
      .register({ key: 'key-0/name', label: 'Name', dirty, cancel, commit: () => null, focus: vi.fn() });
    try {
      mocks.index.mockResolvedValueOnce(
        csvTableIndex(rows.slice(0, 2), { baseVersions: [{ path: 'ships.csv', fingerprint: 'external' }] }),
      );
      mocks.affected.mockReturnValueOnce(true);
      const event = committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot);
      await dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
      expect(document.externalUpdatePending).toBe(true);
      expect(document.baseVersions).toEqual(versions);
      expect(dirty.value).toBe(true);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
  it.each(['resolve', 'reject'] as const)('ends an external index %s when the view is released', async (completion) => {
    harness();
    await flushPromises();
    let finish!: (index: CsvTableIndex) => void, fail!: (error: Error) => void;
    mocks.index.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    mocks.affected.mockReturnValueOnce(true);
    const event = committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot);
    const delivered = dispatchProjectChangeFixture({ ...event, reason: 'refresh' });
    await flushPromises();
    wrapper.unmount();
    await delivered;
    if (completion === 'resolve') finish(csvTableIndex([], { baseVersions: [{ path: 'ships.csv', fingerprint: 'late' }] }));
    else fail(new Error('Late refresh'));
    await flushPromises();
    expect(useCsvEditorStore().getCsvModState(target.modRoot)!.documents.ships.baseVersions).toEqual(versions);
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it.each(['key-900/name', 'key-900'])('locates the hidden unloaded target %s and preserves drafts', async (path) => {
    const vm = harness();
    await flushPromises();
    useCsvEditorStore().updateCellValue({ ...target, rowKey: 'key-0', column: 'name' }, 'Local');
    await vm.setSearchText('id-0');
    await flushPromises();
    expect(await vm.locateProblem({ code: 'csv.relation', severity: 'warning', path, message: 'Sample' })).toEqual({
      rowKey: 'key-900',
      column: path.endsWith('/name') ? 'name' : undefined,
    });
    await flushPromises();
    expect(vm.model.view.searchText).toBe('');
    expect(vm.model.view.rowsByKey['key-900']!.data.id).toBe('id-900');
    expect(vm.model.view.rowsByKey['key-0']!.data.name).toBe('Local');
  });
  it('searches sparse drafts including added, removed and moved rows without saving', async () => {
    const vm = harness();
    await flushPromises();
    const tables = useCsvEditorStore(),
      document = tables.getCsvModState(target.modRoot)!.documents.ships;
    tables.updateCellValue({ ...target, rowKey: 'key-0', column: 'id' }, 'local');
    tables.updateCellValue({ ...target, rowKey: 'key-1', column: 'id' }, 'local');
    tables.deleteRows(target, ['key-2']);
    const created = tables.addNewRow(target)!.rowKey;
    tables.updateCellValue({ ...target, rowKey: created, column: 'id' }, 'local');
    tables.moveRows(target, [created], 0);
    const order = [...document.rowOrder],
      dirty = deepClone(document.dirty);
    mocks.index.mockClear();
    mocks.rows.mockClear();
    await vm.setSearchText('local');
    await flushPromises();
    expect(vm.gridModel.value.rowKeys).toEqual([created, 'key-0', 'key-1']);
    expect(document.rowOrder).toEqual(order);
    expect(document.dirty).toEqual(dirty);
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(mocks.index).toHaveBeenCalledExactlyOnceWith('session', 'ships', 0, 'local', 'id-name', expect.any(AbortSignal));
    expect(mocks.rows).not.toHaveBeenCalled();
    await vm.setSearchText('id-');
    await flushPromises();
    expect(vm.gridModel.value.rowKeys).not.toContain('key-0');
    expect(vm.gridModel.value.rowKeys).not.toContain('key-2');
    await vm.setSearchText('');
    await flushPromises();
    expect(vm.gridModel.value.rowKeys).toEqual(order);
    expect(document.dirty).toEqual(dirty);
  });
  it('keeps the selected rows after edits, save acceptance and returning to the page', async () => {
    let vm = harness();
    await flushPromises();
    await vm.setSearchText('id-0');
    await flushPromises();
    const tables = useCsvEditorStore();
    mocks.index.mockClear();
    tables.updateCellValue({ ...target, rowKey: 'key-0', column: 'id' }, 'edited');
    tables.updateCellValue({ ...target, rowKey: 'key-1', column: 'id' }, 'id-0');
    await flushPromises();
    expect(vm.gridModel.value.rowKeys).toEqual(['key-0']);
    expect(mocks.index).not.toHaveBeenCalled();
    rows[0]!.data.id = 'edited';
    mocks.affected.mockReturnValueOnce(true);
    await dispatchProjectChangeFixture(committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot));
    expect(vm.gridModel.value.rowKeys).toEqual(['key-0']);
    wrapper.unmount();
    vm = harness();
    await flushPromises();
    expect(vm.gridModel.value.rowKeys).toEqual(['key-0']);
    await vm.setSearchText('id-0');
    await flushPromises();
    expect(vm.gridModel.value.rowKeys).toEqual(['key-1']);
  });
  it('binds search membership to the draft captured before its query completes', async () => {
    const vm = harness();
    await flushPromises();
    let finish!: (value: CsvTableIndex) => void;
    mocks.index.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vm.setSearchText('id-0');
    await flushPromises();
    useCsvEditorStore().updateCellValue({ ...target, rowKey: 'key-0', column: 'id' }, 'later');
    finish(csvTableIndex([], { rowKeys: ['key-0'], validationRows: rows, header: ['id', 'name'], baseVersions: versions }));
    await flushPromises();
    expect(vm.gridModel.value.rowKeys).toEqual(['key-0']);
    expect(vm.gridModel.value.rowsByKey['key-0']!.data.id).toBe('later');
  });
  it('accepts its saved index once and completes saving without a second viewport read', async () => {
    const vm = harness();
    await flushPromises();
    const store = useCsvEditorStore();
    store.setSaving(target, true);
    mocks.index.mockClear();
    mocks.rows.mockClear();
    mocks.affected.mockReturnValueOnce(true);
    await dispatchProjectChangeFixture(committedChangeFixture(savedWriteFixture(), target.sessionId, target.modRoot));
    store.setSaving(target, false);
    await flushPromises();
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect(mocks.rows).toHaveBeenCalledTimes(0);
    expect(vm.gridModel.value.rowKeys).toHaveLength(1000);
  });
  it('locates an unloaded exact row and keeps an existing draft', async () => {
    harness();
    await flushPromises();
    useCsvEditorStore().updateCellValue({ ...target, rowKey: 'key-0', column: 'name' }, 'Local');
    useWorkspaceStore().entityLocation = { ...target, kind: 'ship', id: 'id-900', rowKey: 'key-900' };
    await flushPromises();
    expect(mocks.rows).toHaveBeenCalledWith('session', 'ships', ['key-900'], expect.any(AbortSignal));
    expect(csvEditorView(target).selectedRowKey).toBe('key-900');
    expect(csvEditorView(target).rowsByKey['key-900']?.data.id).toBe('id-900');
    expect(csvEditorView(target).rowsByKey['key-0']?.data.name).toBe('Local');
    expect(useWorkspaceStore().entityLocation).toBeNull();
  });
  it.each(['selection', 'table', 'newer'] as const)('invalidates a late location after %s changes', async (reason) => {
    harness();
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
    if (reason === 'selection') useCsvEditorStore().selectRowByKey(target, 'key-10');
    else if (reason === 'table') useCsvEditorStore().switchTab(target.modRoot, 'wings');
    else workspace.entityLocation = { ...target, kind: 'ship', id: 'id-800', rowKey: 'key-800' };
    await flushPromises();
    finish(readRows(['key-900']));
    await flushPromises();
    expect(csvEditorView(target).selectedRowKey).toBe(reason === 'selection' ? 'key-10' : reason === 'newer' ? 'key-800' : null);
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
    mocks.sources.mockResolvedValue([
      { origin: 'mod', options: [{ label: 'Sample system', value: 'sample-system', description: null, resourceRef: null, origin: 'mod' }] },
    ]);
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
    const duplicate = vm.loadTableWindow(240, 160);
    const range = vm.ensureTableRows(['key-240', 'key-399']);
    expect(mocks.rows).toHaveBeenCalledTimes(2);
    while (releases.length) {
      releases.shift()!();
      await flushPromises();
    }
    await loading;
    await duplicate;
    expect(await range).toBe(true);
    expect(maximum).toBe(2);
    expect(mocks.rows.mock.calls.every((call) => call[2].length <= 160)).toBe(true);
    expect(Object.keys(vm.gridModel.value.rowsByKey)).toHaveLength(1000);
  });
  it('loads the actual identities after moving an unloaded target into the viewport', async () => {
    const vm = harness();
    await flushPromises();
    useCsvEditorStore().moveRows(target, ['key-900'], 0);
    await vm.loadTableWindow(0, 40);
    expect(mocks.rows).toHaveBeenLastCalledWith('session', 'ships', ['key-900'], expect.any(AbortSignal));
    expect(csvEditorView(target).rows[0]?.rowKey).toBe('key-900');
  });
  it('reuses loaded range contents without another row, index or source read', async () => {
    const vm = harness();
    await flushPromises();
    mocks.index.mockClear();
    mocks.sources.mockClear();
    mocks.rows.mockClear();
    expect(await vm.ensureTableRows(['key-1', 'key-239'])).toBe(true);
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(await vm.ensureTableRows(['key-240', 'key-399'])).toBe(true);
    expect(mocks.rows).toHaveBeenCalledExactlyOnceWith(target.sessionId, target.table, ['key-240', 'key-399'], expect.any(AbortSignal));
    expect(await vm.ensureTableRows(['key-240', 'key-399'])).toBe(true);
    expect(mocks.rows).toHaveBeenCalledTimes(1);
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
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
    expect(csvEditorView(target).hasCurrentTableExternalUpdate).toBe(false);
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
    expect(csvEditorView(target).rows[0]?.data.id).toBe('local');
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
    const first = csvEditorView(target).rows[0],
      columns = vm.effectiveColumns.value;
    await vm.setSearchText('id-99');
    await flushPromises();
    expect(mocks.index).toHaveBeenLastCalledWith('session', 'ships', 0, 'id-99', 'id-name', expect.any(AbortSignal));
    expect(vm.gridModel.value.rowKeys).toContain('key-990');
    await vm.setSearchText('');
    await flushPromises();
    expect(csvEditorView(target).rows[0]).toBe(first);
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
