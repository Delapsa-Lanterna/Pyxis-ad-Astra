import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTablesStore } from '@/stores/tables.store';
import { TABLE_KEYS, type CsvTableWindow, type ProjectManifest, type TableSummary } from '@/shared/types';
import {
  applyCsvDraftOperation,
  applyCsvTableWindowDraft,
  commitCsvTableSaveDraft,
  createCsvRowDraft,
  setCsvCellValueDraft,
  moveCsvRowDraft,
  hasCsvRowOrderChanges,
  hasCsvTableDraftChanges,
  csvDraftSourceRanges,
  deleteSelectedCsvRowDraft,
} from './csv-table-draft';
import { getAssociatedSpecCandidates } from './associated-spec-candidates';

beforeEach(() => setActivePinia(createPinia()));

function fixture() {
  const tables = useTablesStore();
  const manifest: ProjectManifest = {
    sessionId: 'session',
    modRoot: 'M:/mod',
    baseVersions: [],
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: {},
    warnings: [],
    tableSummaries: Object.fromEntries(
      TABLE_KEYS.map<[string, TableSummary]>((key) => [key, { path: `${key}.csv`, header: [], available: true, totalRows: 0 }]),
    ) as ProjectManifest['tableSummaries'],
    tableEntitySummaries: Object.fromEntries(TABLE_KEYS.map((key) => [key, 0])) as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0, factions: 0, missions: 0 },
  };
  tables.initializeModTables({ sessionId: manifest.sessionId, modRoot: 'M:/mod', manifest });
  const state = tables.getModTableState('M:/mod')!;
  const window: CsvTableWindow = {
    table: 'ships',
    baseVersions: [{ path: 'ship_data.csv', fingerprint: 'base' }],
    header: ['id', '_rowKey', '_faction', '_insertAt', '_sourceRowIndex'],
    totalRows: 1,
    filteredRows: 1,
    start: 0,
    rows: [
      {
        rowKey: 'ships:row:0',
        isComment: false,
        sourceRowIndex: 0,

        data: { id: 'ship', _rowKey: 'business-key', _faction: 'business-faction', _insertAt: '001', _sourceRowIndex: '02' },
      },
    ],
  };
  applyCsvTableWindowDraft(state, window);
  return { state, window };
}

describe('CSV business content and metadata acceptance', () => {
  function orderedFixture(count = 6, loaded = Array.from({ length: count }, (_, index) => index)) {
    const { state, window } = fixture();
    window.totalRows = window.filteredRows = count;
    window.rows = loaded.map((index) => ({
      rowKey: `ships:row:${index}`,
      sourceRowIndex: index,
      isComment: index === 1,
      data: { id: index === 2 ? '' : `row-${index}` },
    }));
    state.tables.ships = [];
    state.originalTables.ships = [];
    for (const row of window.rows) applyCsvTableWindowDraft(state, { ...window, start: row.sourceRowIndex, rows: [row] });
    return { state, window };
  }

  it.each([
    [0, 5],
    [5, 0],
    [2, 4],
  ])('moves %i to %i and reverses the same row identity', (from, to) => {
    const { state } = orderedFixture();
    const row = state.tables.ships[from]!;
    const operation = moveCsvRowDraft(state, 'ships', row.rowKey, to).historyOperation!;
    expect(state.tables.ships[to]).toBe(row);
    expect(state.selectedRowKey).toBe(row.rowKey);
    expect(hasCsvRowOrderChanges(state, 'ships')).toBe(true);
    expect(hasCsvTableDraftChanges(state, 'ships')).toBe(true);
    expect(state.dirty.ships).toEqual({});
    applyCsvDraftOperation(state, operation, 'undo');
    expect(state.rowOrders.ships).toEqual([0, 1, 2, 3, 4, 5]);
    expect(hasCsvTableDraftChanges(state, 'ships')).toBe(false);
    applyCsvDraftOperation(state, operation, 'redo');
    expect(state.tables.ships[to]).toBe(row);
    expect(moveCsvRowDraft(state, 'ships', row.rowKey, to).changed).toBe(false);
  });

  it('loads source windows into reordered placeholders while preserving local content and rejecting an external baseline', () => {
    const { state, window } = orderedFixture(6, [0, 5]);
    moveCsvRowDraft(state, 'ships', 'ships:row:5', 0);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', 'draft');
    expect(csvDraftSourceRanges(state, 'ships', 0, 6)).toEqual([{ start: 1, count: 4 }]);
    const row = { rowKey: 'ships:row:2', sourceRowIndex: 2, isComment: false, data: { id: '' } };
    applyCsvTableWindowDraft(state, { ...window, start: 2, rows: [row] });
    expect(state.tables.ships[3]).toMatchObject(row);
    expect(state.tables.ships[1]?.data.id).toBe('draft');
    applyCsvTableWindowDraft(state, { ...window, baseVersions: [], rows: [row] });
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
    expect(state.rowOrders.ships).toEqual([5, 0, 1, 2, 3, 4]);
  });

  it('combines moves, creation and deletion through one reversible order', () => {
    const { state } = orderedFixture();
    const moved = moveCsvRowDraft(state, 'ships', 'ships:row:4', 0).historyOperation!;
    const created = createCsvRowDraft(state, 1).historyOperation!;
    state.selectedRowKey = 'ships:row:1';
    const deleted = deleteSelectedCsvRowDraft(state).historyOperation!;
    expect(state.rowOrders.ships).toEqual([4, created.rowKey, 0, 2, 3, 5]);
    for (const operation of [deleted, created, moved]) applyCsvDraftOperation(state, operation, 'undo');
    expect(state.rowOrders.ships).toEqual([0, 1, 2, 3, 4, 5]);
    expect(hasCsvTableDraftChanges(state, 'ships')).toBe(false);
    for (const operation of [moved, created, deleted]) applyCsvDraftOperation(state, operation, 'redo');
    expect(state.rowOrders.ships).toEqual([4, created.rowKey, 0, 2, 3, 5]);
  });

  it('accepts additional query dependencies against the saved CSV version scope', () => {
    const { state, window } = orderedFixture(6, [0, 5]);
    moveCsvRowDraft(state, 'ships', 'ships:row:5', 0);
    commitCsvTableSaveDraft(state, 'ships', [], [], [...state.rowOrders.ships!]);
    const row = { rowKey: 'ships:row:2', sourceRowIndex: 3, isComment: false, data: { id: '' } };
    applyCsvTableWindowDraft(state, {
      ...window,
      rows: [row],
      baseVersions: [...window.baseVersions, { path: 'data/hulls/extra.ship', fingerprint: 'spec' }],
    });
    expect(state.tables.ships[3]?.rowKey).toBe(row.rowKey);
    expect(state.pendingExternalTableUpdates.ships).toBe(false);
    applyCsvTableWindowDraft(state, { ...window, rows: [row], baseVersions: [{ path: 'ship_data.csv', fingerprint: 'changed' }] });
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
  });

  it('accepts a captured permutation while retaining a later undo and edits', () => {
    const { state } = orderedFixture();
    const moved = moveCsvRowDraft(state, 'ships', 'ships:row:5', 0).historyOperation!;
    const submitted = [...state.rowOrders.ships!];
    applyCsvDraftOperation(state, moved, 'undo');
    setCsvCellValueDraft(state, 'ships', 'ships:row:3', 'id', 'later');
    commitCsvTableSaveDraft(state, 'ships', [], [], submitted);
    expect(state.originalTables.ships.map((row) => row?.rowKey)).toEqual([
      'ships:row:5',
      'ships:row:0',
      'ships:row:1',
      'ships:row:2',
      'ships:row:3',
      'ships:row:4',
    ]);
    expect(state.rowOrders.ships).toEqual([1, 2, 3, 4, 5, 0]);
    expect(state.tables.ships.map((row) => row?.sourceRowIndex)).toEqual([1, 2, 3, 4, 5, 0]);
    expect(state.dirty.ships['ships:row:3']).toMatchObject({ cells: { id: 'later' } });
    expect(hasCsvRowOrderChanges(state, 'ships')).toBe(true);
  });

  it.each([
    { selected: null, source: 0, expectedIndex: 2, boundary: null },
    { selected: 'ships:row:0', source: 0, expectedIndex: 1, boundary: 1 },
    { selected: 'ships:row:1', source: 0, expectedIndex: 2, boundary: 2 },
    { selected: 'ships:row:0', source: 7, expectedIndex: 1, boundary: 8 },
  ])('inserts after $selected using source position $source', ({ selected, source, expectedIndex, boundary }) => {
    const { state, window } = fixture();
    window.rows = [
      { ...window.rows[0]!, sourceRowIndex: source },
      { ...window.rows[0]!, rowKey: 'ships:row:1', sourceRowIndex: source + 4, data: { id: 'second' } },
    ];
    if (source === 0) window.rows[1]!.sourceRowIndex = 1;
    window.totalRows = source + 5;
    window.filteredRows = 2;
    applyCsvTableWindowDraft(state, window);
    state.selectedRowKey = selected;
    const result = createCsvRowDraft(state, 1);
    const rowKey = state.selectedRowKey;
    expect(state.tables.ships[expectedIndex]).toMatchObject({ rowKey, sourceRowIndex: null, insertAt: boundary });
    expect(result.historyOperation).toMatchObject({ rowIndex: expectedIndex });
    expect(state.filteredRows.ships).toBe(3);
    expect(state.totalRows.ships).toBe(source + 6);
    applyCsvDraftOperation(state, result.historyOperation!, 'undo');
    expect(state.tables.ships.map((row) => row?.rowKey)).toEqual(window.rows.map((row) => row.rowKey));
    applyCsvDraftOperation(state, result.historyOperation!, 'redo');
    expect(state.tables.ships[expectedIndex]).toMatchObject({ rowKey, insertAt: boundary });
  });

  it('inserts consecutive rows below the new selection while retaining unloaded slots', () => {
    const { state, window } = fixture();
    window.start = 3;
    window.totalRows = window.filteredRows = 6;
    window.rows[0]!.sourceRowIndex = 3;
    state.tables.ships = [];
    state.originalTables.ships = [];
    applyCsvTableWindowDraft(state, window);
    state.selectedRowKey = 'ships:row:0';
    const first = createCsvRowDraft(state, 1).historyOperation!;
    const second = createCsvRowDraft(state, 2).historyOperation!;
    expect(state.tables.ships.slice(3, 6).map((row) => row?.rowKey)).toEqual(['ships:row:0', first.rowKey, second.rowKey]);
    expect(state.tables.ships.slice(4, 6).map((row) => row?.insertAt)).toEqual([4, 4]);
    expect(state.tables.ships[6]).toBeNull();
    expect(state.selectedRowKey).toBe(second.rowKey);
  });

  it('edits prototype-named business columns and records their dirty cells as own keys', () => {
    const { state, window } = fixture();
    window.header = ['id', '__proto__', 'constructor'];
    window.rows[0]!.data = JSON.parse('{"id":"ship","__proto__":"original"}');
    applyCsvTableWindowDraft(state, window);
    expect(state.tables.ships[0]!.data.constructor).toBeUndefined();
    const edit = setCsvCellValueDraft(state, 'ships', 'ships:row:0', '__proto__', 'edited');
    expect(Object.hasOwn(state.tables.ships[0]!.data, '__proto__')).toBe(true);
    expect(state.tables.ships[0]!.data.__proto__).toBe('edited');
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: JSON.parse('{"__proto__":"edited"}') });
    applyCsvDraftOperation(state, edit.historyOperation!, 'undo');
    expect(state.tables.ships[0]!.data.__proto__).toBe('original');
    expect(state.dirty.ships).toEqual({});
  });
  it('retains quoted hash data during other edits and restores its exact flag through history', () => {
    const { state, window } = fixture();
    window.rows[0]!.data.id = '#quoted';
    applyCsvTableWindowDraft(state, window);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', '_rowKey', '#other-column');
    expect(state.tables.ships[0]?.isComment).toBe(false);
    const edit = setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', '#disabled');
    expect(state.tables.ships[0]?.isComment).toBe(true);
    applyCsvDraftOperation(state, edit.historyOperation!, 'undo');
    expect(state.tables.ships[0]).toMatchObject({ data: { id: '#quoted' }, isComment: false });
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { _rowKey: '#other-column' } });
    applyCsvDraftOperation(state, edit.historyOperation!, 'redo');
    expect(state.tables.ships[0]?.isComment).toBe(true);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', '#quoted');
    expect(state.tables.ships[0]?.isComment).toBe(false);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', ' #space');
    expect(state.tables.ships[0]?.isComment).toBe(false);
  });

  it('retains a later comment edit against the captured saved baseline', () => {
    const { state, window } = fixture();
    window.rows[0]!.data.id = '#quoted';
    applyCsvTableWindowDraft(state, window);
    const edit = setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', '#comment');
    commitCsvTableSaveDraft(
      state,
      'ships',
      [{ rowKey: 'ships:row:0', action: 'upsert', row: { ...window.rows[0]!.data }, isComment: false }],
      [],
    );
    expect(state.originalTables.ships[0]).toMatchObject({ data: { id: '#quoted' }, isComment: false });
    expect(state.tables.ships[0]).toMatchObject({ data: { id: '#comment' }, isComment: true });
    applyCsvDraftOperation(state, edit.historyOperation!, 'undo');
    expect(state.tables.ships[0]?.isComment).toBe(false);
    expect(state.dirty.ships).toEqual({});
    applyCsvDraftOperation(state, edit.historyOperation!, 'redo');
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { id: '#comment' } });
  });

  it('compares comment semantics in external baselines and associated spec candidates', () => {
    const { state, window } = fixture();
    window.header = ['name', 'id'];
    window.rows[0]!.data = { name: '#note', id: 'ship' };
    window.rows[0]!.isComment = true;
    applyCsvTableWindowDraft(state, window);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', 'renamed');
    expect(getAssociatedSpecCandidates(state, 'ships', ['ships'])).toEqual([]);
    state.dirty.ships['ships:row:0'] = { action: 'delete' };
    expect(getAssociatedSpecCandidates(state, 'ships', ['ships'])).toEqual([]);
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'name', 'active');
    expect(getAssociatedSpecCandidates(state, 'ships', ['ships'])[0]?.change).toMatchObject({
      action: 'create',
      create: { id: 'renamed' },
    });
    const refreshed = { ...window, rows: [{ ...window.rows[0]!, isComment: false }] };
    applyCsvTableWindowDraft(state, refreshed, true);
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
    expect(state.tables.ships[0]?.data.name).toBe('active');
  });

  it('keeps colliding business columns editable under their formal row identity', () => {
    const { state } = fixture();
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', '_rowKey', 'changed-business');
    expect(state.tables.ships[0]).toMatchObject({
      rowKey: 'ships:row:0',

      sourceRowIndex: 0,
      insertAt: null,
      data: { _rowKey: 'changed-business', _faction: 'business-faction', _insertAt: '001', _sourceRowIndex: '02' },
    });
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { _rowKey: 'changed-business' } });
  });

  it('accepts same-version metadata while keeping committed edits and pending input', () => {
    const { state, window } = fixture();
    setCsvCellValueDraft(state, 'ships', 'ships:row:0', 'id', 'draft');
    const refreshed = { ...window, rows: window.rows.map((row) => ({ ...row, sourceRowIndex: 3 })) };
    applyCsvTableWindowDraft(state, refreshed, true);
    expect(state.tables.ships[0]?.data.id).toBe('draft');
    expect(state.tables.ships[0]?.sourceRowIndex).toBe(3);
    expect(state.originalTables.ships[0]?.sourceRowIndex).toBe(3);
    expect(state.originalTables.ships[0]?.data.id).toBe('ship');
    expect(state.dirty.ships['ships:row:0']).toEqual({ action: 'upsert', cells: { id: 'draft' } });
    expect(state.pendingExternalTableUpdates.ships).toBe(false);
    applyCsvTableWindowDraft(state, { ...refreshed, baseVersions: [{ path: 'ship_data.csv', fingerprint: 'external' }] }, true);
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
    expect(state.tables.ships[0]?.data.id).toBe('draft');
  });
});
