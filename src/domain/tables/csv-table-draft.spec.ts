import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTablesStore } from '@/stores/tables.store';
import { sessionUpdateFixture } from '@/test/write-result';
import { csvDraftRow, csvTableIndex } from '@/test/csv-row';
import {
  applyCsvDraftOperation,
  applyCsvTableIndexDraft,
  applyCsvTableRowsDraft,
  commitCsvTableSaveDraft,
  createCsvRowDraft,
  setCsvCellValueDraft,
  moveCsvRowDraft,
  hasCsvRowOrderChanges,
  hasCsvTableDraftChanges,
  deleteSelectedCsvRowDraft,
  replaceCsvTableDraft,
} from './csv-table-draft';
import { getAssociatedSpecCandidates } from './associated-spec-candidates';
import type { CsvRowKeyMapping } from '@/shared/types';
beforeEach(() => setActivePinia(createPinia()));
const key = (index: number) => 'ships:row:' + index;
function fixture(count = 6, loaded = Array.from({ length: count }, (_, index) => index)) {
  const tables = useTablesStore(),
    manifest = sessionUpdateFixture('session', 'M:/mod').projection.manifest;
  tables.initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
  const state = tables.getModTableState(manifest.modRoot)!;
  const index = csvTableIndex(
    loaded.map((position) => csvDraftRow({ id: 'row-' + position, name: 'Name ' + position }, key(position), position === 1)),
    {
      header: ['id', 'name'],
      rowKeys: Array.from({ length: count }, (_, index) => key(index)),
      totalRows: count,
      baseVersions: [{ path: 'ships.csv', fingerprint: 'base' }],
    },
  );
  applyCsvTableIndexDraft(state, index);
  return { state, index };
}
describe('CSV keyed baseline, order and draft acceptance', () => {
  it.each([
    [0, 5],
    [5, 0],
    [2, 4],
  ])('moves %i to %i and reverses the same record', (from, to) => {
    const { state } = fixture(),
      row = state.tables.ships[key(from)];
    const operation = moveCsvRowDraft(state, 'ships', key(from), to).historyOperation!;
    expect(state.tables.ships[key(from)]).toBe(row);
    expect(state.rowOrders.ships[to]).toBe(key(from));
    expect(state.selectedRowKey).toBe(key(from));
    expect(hasCsvTableDraftChanges(state, 'ships')).toBe(true);
    expect(state.dirty.ships).toEqual({});
    applyCsvDraftOperation(state, operation, 'undo');
    expect(state.rowOrders.ships).toEqual(Array.from({ length: 6 }, (_, index) => key(index)));
    expect(hasCsvTableDraftChanges(state, 'ships')).toBe(false);
    applyCsvDraftOperation(state, operation, 'redo');
    expect(state.rowOrders.ships[to]).toBe(key(from));
    expect(moveCsvRowDraft(state, 'ships', key(from), to).changed).toBe(false);
  });
  it('accepts unloaded records by identity after moving them and preserves edited content', () => {
    const { state, index } = fixture(6, [0, 5]);
    moveCsvRowDraft(state, 'ships', key(5), 0);
    setCsvCellValueDraft(state, 'ships', key(0), 'id', 'draft');
    const rows = [csvDraftRow({ id: '' }, key(2)), index.rows[0]!];
    applyCsvTableRowsDraft(state, { table: 'ships', baseVersions: index.baseVersions, rows });
    expect(state.tables.ships[key(2)]?.data.id).toBe('');
    expect(state.tables.ships[key(0)]?.data.id).toBe('draft');
    expect(state.rowOrders.ships).toEqual([5, 0, 1, 2, 3, 4].map(key));
    applyCsvTableRowsDraft(state, { table: 'ships', baseVersions: [{ path: 'ships.csv', fingerprint: 'external' }], rows });
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
  });
  it('keeps filtered identities separate from the full draft and retains cached records', () => {
    const { state, index } = fixture();
    const first = state.tables.ships[key(0)];
    applyCsvTableIndexDraft(state, { ...index, rowKeys: [key(3)], rows: [] }, true);
    expect(state.queryRowKeys.ships).toEqual([key(3)]);
    expect(state.rowOrders.ships).toHaveLength(6);
    expect(state.tables.ships[key(0)]).toBe(first);
    applyCsvTableIndexDraft(state, { ...index, rows: [] });
    expect(state.queryRowKeys.ships).toBeUndefined();
    expect(state.tables.ships[key(0)]).toBe(first);
  });
  it('combines move, create and delete through one reversible identity sequence', () => {
    const { state } = fixture();
    const moved = moveCsvRowDraft(state, 'ships', key(4), 0).historyOperation!;
    const created = createCsvRowDraft(state, 1).historyOperation!;
    state.selectedRowKey = key(1);
    const deleted = deleteSelectedCsvRowDraft(state).historyOperation!;
    expect(state.rowOrders.ships).toEqual([key(4), created.rowKey, key(0), key(2), key(3), key(5)]);
    for (const operation of [deleted, created, moved]) applyCsvDraftOperation(state, operation, 'undo');
    expect(state.rowOrders.ships).toEqual(Array.from({ length: 6 }, (_, index) => key(index)));
    expect(hasCsvTableDraftChanges(state, 'ships')).toBe(false);
    for (const operation of [moved, created, deleted]) applyCsvDraftOperation(state, operation, 'redo');
    expect(state.rowOrders.ships).toEqual([key(4), created.rowKey, key(0), key(2), key(3), key(5)]);
  });
  it('accepts source dependencies against a saved CSV version without replacing local content', () => {
    const { state, index } = fixture(6, [0, 5]);
    moveCsvRowDraft(state, 'ships', key(5), 0);
    commitCsvTableSaveDraft(state, 'ships', [], [], [...state.rowOrders.ships]);
    setCsvCellValueDraft(state, 'ships', key(0), 'id', 'later');
    const next = {
      ...index,
      rowKeys: [...state.originalRowOrders.ships],
      baseVersions: [...index.baseVersions, { path: 'extra.ship', fingerprint: 'spec' }],
    };
    applyCsvTableIndexDraft(state, next);
    expect(state.pendingExternalTableUpdates.ships).toBe(false);
    expect(state.tables.ships[key(0)]?.data.id).toBe('later');
    applyCsvTableIndexDraft(state, { ...next, baseVersions: [{ path: 'ships.csv', fingerprint: 'changed' }] });
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
  });
  it('accepts a captured permutation while retaining a later undo and field edit', () => {
    const { state } = fixture();
    const moved = moveCsvRowDraft(state, 'ships', key(5), 0).historyOperation!;
    const submitted = [...state.rowOrders.ships];
    applyCsvDraftOperation(state, moved, 'undo');
    setCsvCellValueDraft(state, 'ships', key(3), 'id', 'later');
    commitCsvTableSaveDraft(state, 'ships', [], [], submitted);
    expect(state.originalRowOrders.ships).toEqual([5, 0, 1, 2, 3, 4].map(key));
    expect(state.rowOrders.ships).toEqual([0, 1, 2, 3, 4, 5].map(key));
    expect(state.dirty.ships[key(3)]).toMatchObject({ cells: { id: 'later' } });
    expect(hasCsvRowOrderChanges(state, 'ships')).toBe(true);
  });
  it.each([null, 0, 1])('inserts below selection %s and restores the sequence through history', (selected) => {
    const { state } = fixture(3);
    state.selectedRowKey = selected === null ? null : key(selected);
    const created = createCsvRowDraft(state, 1).historyOperation!;
    const position = selected === null ? 3 : selected + 1;
    expect(state.rowOrders.ships[position]).toBe(created.rowKey);
    expect(state.totalRows.ships).toBe(4);
    expect(hasCsvRowOrderChanges(state, 'ships')).toBe(true);
    applyCsvDraftOperation(state, created, 'undo');
    expect(state.rowOrders.ships).toEqual([0, 1, 2].map(key));
    applyCsvDraftOperation(state, created, 'redo');
    expect(state.rowOrders.ships[position]).toBe(created.rowKey);
  });
  it('inserts consecutive rows after a selected record while unloaded identities retain their positions', () => {
    const { state } = fixture(6, [3]);
    state.selectedRowKey = key(3);
    const first = createCsvRowDraft(state, 1).historyOperation!,
      second = createCsvRowDraft(state, 2).historyOperation!;
    expect(state.rowOrders.ships.slice(3, 7)).toEqual([key(3), first.rowKey, second.rowKey, key(4)]);
    expect(state.tables.ships[key(4)]).toBeUndefined();
    expect(state.selectedRowKey).toBe(second.rowKey);
  });
  it('retains the record and data object when its temporary identity is accepted', () => {
    const { state } = fixture(1);
    const created = createCsvRowDraft(state, 1).historyOperation!;
    const row = state.tables.ships[created.rowKey]!,
      data = row.data;
    const order = [...state.rowOrders.ships];
    const patches = [{ rowKey: created.rowKey, action: 'upsert' as const, row: { ...data }, isComment: false }];
    commitCsvTableSaveDraft(state, 'ships', patches, [{ previousKey: created.rowKey, nextKey: key(9), rowIndex: 1 }], order);
    expect(state.tables.ships[key(9)]).toBe(row);
    expect(row.data).toBe(data);
    expect(state.rowOrders.ships).toEqual([key(0), key(9)]);
    expect(hasCsvTableDraftChanges(state, 'ships')).toBe(false);
  });
  it('retains a submitted creation undone during saving as a deletion against the saved baseline', () => {
    const { state } = fixture(1);
    const created = createCsvRowDraft(state, 1).historyOperation!;
    if (created.type !== 'row-created') throw Error('fixture creates a row');
    const order = [...state.rowOrders.ships];
    applyCsvDraftOperation(state, created, 'undo');
    commitCsvTableSaveDraft(
      state,
      'ships',
      [{ rowKey: created.rowKey, action: 'upsert', row: created.row.data, isComment: false }],
      [{ previousKey: created.rowKey, nextKey: key(9), rowIndex: 1 }],
      order,
    );
    expect(state.originalRowOrders.ships).toEqual([key(0), key(9)]);
    expect(state.rowOrders.ships).toEqual([key(0)]);
    expect(state.dirty.ships[key(9)]).toEqual({ action: 'delete' });
  });
  it('rebases a deletion undone during saving into a new identity at the retained position', () => {
    const { state } = fixture(3);
    state.selectedRowKey = key(1);
    const deletion = deleteSelectedCsvRowDraft(state).historyOperation!;
    const order = [...state.rowOrders.ships];
    applyCsvDraftOperation(state, deletion, 'undo');
    const mapped: CsvRowKeyMapping[] = [];
    commitCsvTableSaveDraft(state, 'ships', [{ rowKey: key(1), action: 'delete', row: {}, isComment: false }], mapped, order);
    expect(state.rowOrders.ships[1]).toContain(':new:');
    expect(state.tables.ships[state.rowOrders.ships[1]!]!.data.id).toBe('row-1');
    expect(mapped).toEqual([{ previousKey: key(1), nextKey: state.rowOrders.ships[1], rowIndex: 1 }]);
    expect(state.originalRowOrders.ships).toEqual([key(0), key(2)]);
  });
  it('edits prototype-named business columns and keeps their exact dirty keys', () => {
    const { state } = fixture(1);
    replaceCsvTableDraft(state, 'ships', [csvDraftRow(JSON.parse('{"id":"ship","__proto__":"original"}'), key(0))]);
    state.headers.ships = ['id', '__proto__', 'constructor'];
    expect(state.tables.ships[key(0)]!.data.constructor).toBeUndefined();
    const edit = setCsvCellValueDraft(state, 'ships', key(0), '__proto__', 'edited');
    expect(Object.hasOwn(state.tables.ships[key(0)]!.data, '__proto__')).toBe(true);
    expect(state.dirty.ships[key(0)]).toEqual({ action: 'upsert', cells: JSON.parse('{"__proto__":"edited"}') });
    applyCsvDraftOperation(state, edit.historyOperation!, 'undo');
    expect(state.tables.ships[key(0)]!.data.__proto__).toBe('original');
    expect(state.dirty.ships).toEqual({});
  });
  it('preserves quoted hash data, comment semantics and associated spec decisions', () => {
    const { state } = fixture(1);
    replaceCsvTableDraft(state, 'ships', [csvDraftRow({ id: '#quoted', name: 'Name' }, key(0))]);
    const edit = setCsvCellValueDraft(state, 'ships', key(0), 'id', '#disabled').historyOperation!;
    expect(state.tables.ships[key(0)]!.isComment).toBe(true);
    applyCsvDraftOperation(state, edit, 'undo');
    expect(state.tables.ships[key(0)]!.isComment).toBe(false);
    expect(state.dirty.ships).toEqual({});
    applyCsvDraftOperation(state, edit, 'redo');
    expect(getAssociatedSpecCandidates(state, 'ships', ['ships'])).toEqual([]);
    commitCsvTableSaveDraft(
      state,
      'ships',
      [{ rowKey: key(0), action: 'upsert', row: { id: '#quoted', name: 'Name' }, isComment: false }],
      [],
    );
    expect(state.tables.ships[key(0)]!.isComment).toBe(true);
    expect(state.originalTables.ships[key(0)]!.isComment).toBe(false);
  });
  it('marks an external update while a raw input owns the original baseline', () => {
    const { state, index } = fixture(1);
    applyCsvTableRowsDraft(
      state,
      { table: 'ships', baseVersions: index.baseVersions, rows: [csvDraftRow({ id: 'changed' }, key(0))] },
      true,
    );
    expect(state.pendingExternalTableUpdates.ships).toBe(true);
    expect(state.tables.ships[key(0)]!.data.id).toBe('row-0');
  });
});
