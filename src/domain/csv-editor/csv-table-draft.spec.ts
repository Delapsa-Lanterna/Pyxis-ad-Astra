import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { csvDraftRow, csvTableIndex } from '@/test/fixtures/csv-row';
import {
  applyCsvDraftOperation,
  applyCsvTableIndexDraft,
  acceptSavedCsvTableIndex,
  applyCsvTableRowsDraft,
  commitCsvTableSaveDraft,
  createCsvRowDraft,
  copyCsvRowDraft,
  setCsvCellValueDraft,
  moveCsvRowDraft,
  hasCsvRowOrderChanges,
  hasCsvTableDraftChanges,
  deleteCsvRowDraft,
  replaceCsvTableDraft,
} from './csv-table-draft';
import { getAssociatedSpecCandidates } from './associated-spec-candidates';
import type { CsvRowKeyMapping } from '@/shared/types';
beforeEach(() => setActivePinia(createPinia()));
const key = (index: number) => 'ships:row:' + index;
function fixture(count = 6, loaded = Array.from({ length: count }, (_, index) => index)) {
  const tables = useCsvEditorStore(),
    manifest = sessionUpdateFixture('session', 'M:/mod').projection.manifest;
  tables.initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
  const state = tables.getCsvModState(manifest.modRoot)!;
  const index = csvTableIndex(
    loaded.map((position) => csvDraftRow({ id: 'row-' + position, name: 'Name ' + position }, key(position), position === 1)),
    {
      header: ['id', 'name'],
      rowKeys: Array.from({ length: count }, (_, index) => key(index)),
      totalRows: count,
      baseVersions: [{ path: 'ships.csv', fingerprint: 'base' }],
    },
  );
  applyCsvTableIndexDraft(state.documents.ships, index);
  return { state, index };
}
describe('CSV keyed baseline, order and draft acceptance', () => {
  it.each([0, 1, 2, 3].flatMap((position) => [false, true].map((comment) => ({ position, comment }))))(
    'copies complete independent rows to $position with comment=$comment through history',
    ({ position, comment }) => {
      const { state } = fixture(3),
        document = state.documents.ships;
      const source = document.rows[key(1)]!;
      source.data.extra = '001';
      source.isComment = comment;
      const operation = copyCsvRowDraft(document, source.rowKey, position).historyOperation!;
      const copy = document.rows[operation.rowKey]!;
      expect(copy.data).toEqual(source.data);
      expect(copy.data).not.toBe(source.data);
      expect(copy.isComment).toBe(comment);
      expect(copy.rowKey).toContain(':new:');
      expect(document.rowOrder[position]).toBe(copy.rowKey);
      expect(document.totalRowCount).toBe(4);
      expect(document.filteredRowCount).toBe(4);
      expect(document.dirty[copy.rowKey]?.action).toBe('upsert');
      setCsvCellValueDraft(document, copy.rowKey, 'extra', 'edited');
      expect(source.data.extra).toBe('001');
      applyCsvDraftOperation(document, operation, 'undo');
      expect(document.rowOrder).toEqual([0, 1, 2].map(key));
      applyCsvDraftOperation(document, operation, 'redo');
      expect(document.rowOrder[position]).toBe(copy.rowKey);
      expect(document.rows[copy.rowKey]!.data.extra).toBe('001');
    },
  );
  it('selects consecutive copies and accepts saved identities into their order and history', () => {
    const { state } = fixture(2),
      document = state.documents.ships,
      tables = useCsvEditorStore();
    const target = { sessionId: 'session', modRoot: 'M:/mod', table: 'ships' as const };
    tables.copyRow(target, key(1), 0);
    const first = state.selectedRowKey!;
    tables.copyRow(target, first, 1);
    const second = state.selectedRowKey!;
    expect(first).not.toBe(second);
    expect(document.rowOrder).toEqual([first, second, key(0), key(1)]);
    expect(document.history.undoStack).toHaveLength(2);
    const order = [...document.rowOrder];
    const patches = [first, second].map((rowKey) => ({
      rowKey,
      action: 'upsert' as const,
      row: { ...document.rows[rowKey]!.data },
      isComment: true,
    }));
    const mapping = [first, second].map((previousKey, rowIndex) => ({ previousKey, nextKey: key(8 + rowIndex), rowIndex }));
    commitCsvTableSaveDraft(document, patches, mapping, order);
    tables.applySavedRowKeyMap(target.modRoot, target.table, mapping);
    expect(document.rowOrder).toEqual([key(8), key(9), key(0), key(1)]);
    expect(state.selectedRowKey).toBe(key(9));
    expect(document.history.undoStack.map((entry) => entry.operation.rowKey)).toEqual([key(8), key(9)]);
    expect(document.baselineRows[key(8)]).toMatchObject({ data: { id: 'row-1', name: 'Name 1' }, isComment: true });
    expect(hasCsvTableDraftChanges(document)).toBe(false);
  });
  it('accepts saved A while preserving unrelated B draft values and history', () => {
    const { state, index } = fixture();
    const document = state.documents.ships;
    setCsvCellValueDraft(document, key(2), 'name', 'Unsaved B');
    const dirty = { ...document.dirty[key(2)] };
    const updated = {
      ...index,
      rows: index.rows.map((row) => (row.rowKey === key(0) ? { ...row, data: { ...row.data, name: 'Saved A' } } : row)),
    };
    acceptSavedCsvTableIndex(document, updated);
    expect(document.rows[key(0)]!.data.name).toBe('Saved A');
    expect(document.rows[key(2)]!.data.name).toBe('Unsaved B');
    expect(document.baselineRows[key(2)]!.data.name).toBe('Name 2');
    expect(document.dirty[key(2)]).toEqual(dirty);
    expect(hasCsvTableDraftChanges(document)).toBe(true);
  });
  it.each([
    [0, 5],
    [5, 0],
    [2, 4],
  ])('moves %i to %i and reverses the same record', (from, to) => {
    const { state } = fixture(),
      row = state.documents.ships.rows[key(from)];
    const operation = moveCsvRowDraft(state.documents.ships, key(from), to).historyOperation!;
    expect(state.documents.ships.rows[key(from)]).toBe(row);
    expect(state.documents.ships.rowOrder[to]).toBe(key(from));
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(true);
    expect(state.documents.ships.dirty).toEqual({});
    applyCsvDraftOperation(state.documents.ships, operation, 'undo');
    expect(state.documents.ships.rowOrder).toEqual(Array.from({ length: 6 }, (_, index) => key(index)));
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(false);
    applyCsvDraftOperation(state.documents.ships, operation, 'redo');
    expect(state.documents.ships.rowOrder[to]).toBe(key(from));
    expect(moveCsvRowDraft(state.documents.ships, key(from), to).changed).toBe(false);
  });
  it('accepts unloaded records by identity after moving them and preserves edited content', () => {
    const { state, index } = fixture(6, [0, 5]);
    moveCsvRowDraft(state.documents.ships, key(5), 0);
    setCsvCellValueDraft(state.documents.ships, key(0), 'id', 'draft');
    const rows = [csvDraftRow({ id: '' }, key(2)), index.rows[0]!];
    applyCsvTableRowsDraft(state.documents.ships, { table: 'ships', baseVersions: index.baseVersions, rows });
    expect(state.documents.ships.rows[key(2)]?.data.id).toBe('');
    expect(state.documents.ships.rows[key(0)]?.data.id).toBe('draft');
    expect(state.documents.ships.rowOrder).toEqual([5, 0, 1, 2, 3, 4].map(key));
    applyCsvTableRowsDraft(state.documents.ships, { table: 'ships', baseVersions: [{ path: 'ships.csv', fingerprint: 'external' }], rows });
    expect(state.documents.ships.externalUpdatePending).toBe(true);
  });
  it('keeps filtered identities separate from the full draft and retains cached records', () => {
    const { state, index } = fixture();
    const first = state.documents.ships.rows[key(0)];
    applyCsvTableIndexDraft(state.documents.ships, { ...index, rowKeys: [key(3)], rows: [] }, true);
    expect(state.documents.ships.queryRowKeys).toEqual([key(3)]);
    expect(state.documents.ships.rowOrder).toHaveLength(6);
    expect(state.documents.ships.rows[key(0)]).toBe(first);
    applyCsvTableIndexDraft(state.documents.ships, { ...index, rows: [] });
    expect(state.documents.ships.queryRowKeys).toBeUndefined();
    expect(state.documents.ships.rows[key(0)]).toBe(first);
  });
  it('combines move, create and delete through one reversible identity sequence', () => {
    const { state } = fixture();
    const moved = moveCsvRowDraft(state.documents.ships, key(4), 0).historyOperation!;
    const created = createCsvRowDraft(state.documents.ships, moved.rowKey, 1).historyOperation!;
    state.selectedRowKey = key(1);
    const deleted = deleteCsvRowDraft(state.documents.ships, state.selectedRowKey!).historyOperation!;
    expect(state.documents.ships.rowOrder).toEqual([key(4), created.rowKey, key(0), key(2), key(3), key(5)]);
    for (const operation of [deleted, created, moved]) applyCsvDraftOperation(state.documents.ships, operation, 'undo');
    expect(state.documents.ships.rowOrder).toEqual(Array.from({ length: 6 }, (_, index) => key(index)));
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(false);
    for (const operation of [moved, created, deleted]) applyCsvDraftOperation(state.documents.ships, operation, 'redo');
    expect(state.documents.ships.rowOrder).toEqual([key(4), created.rowKey, key(0), key(2), key(3), key(5)]);
  });
  it('accepts source dependencies against a saved CSV version without replacing local content', () => {
    const { state, index } = fixture(6, [0, 5]);
    moveCsvRowDraft(state.documents.ships, key(5), 0);
    commitCsvTableSaveDraft(state.documents.ships, [], [], [...state.documents.ships.rowOrder]);
    setCsvCellValueDraft(state.documents.ships, key(0), 'id', 'later');
    const next = {
      ...index,
      rowKeys: [...state.documents.ships.baselineRowOrder],
      baseVersions: [...index.baseVersions, { path: 'extra.ship', fingerprint: 'spec' }],
    };
    applyCsvTableIndexDraft(state.documents.ships, next);
    expect(state.documents.ships.externalUpdatePending).toBe(false);
    expect(state.documents.ships.rows[key(0)]?.data.id).toBe('later');
    applyCsvTableIndexDraft(state.documents.ships, { ...next, baseVersions: [{ path: 'ships.csv', fingerprint: 'changed' }] });
    expect(state.documents.ships.externalUpdatePending).toBe(true);
  });
  it('accepts a captured permutation while retaining a later undo and field edit', () => {
    const { state } = fixture();
    const moved = moveCsvRowDraft(state.documents.ships, key(5), 0).historyOperation!;
    const submitted = [...state.documents.ships.rowOrder];
    applyCsvDraftOperation(state.documents.ships, moved, 'undo');
    setCsvCellValueDraft(state.documents.ships, key(3), 'id', 'later');
    commitCsvTableSaveDraft(state.documents.ships, [], [], submitted);
    expect(state.documents.ships.baselineRowOrder).toEqual([5, 0, 1, 2, 3, 4].map(key));
    expect(state.documents.ships.rowOrder).toEqual([0, 1, 2, 3, 4, 5].map(key));
    expect(state.documents.ships.dirty[key(3)]).toMatchObject({ cells: { id: 'later' } });
    expect(hasCsvRowOrderChanges(state.documents.ships)).toBe(true);
  });
  it.each([null, 0, 1])('inserts below selection %s and restores the sequence through history', (selected) => {
    const { state } = fixture(3);
    state.selectedRowKey = selected === null ? null : key(selected);
    const created = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyOperation!;
    const position = selected === null ? 3 : selected + 1;
    expect(state.documents.ships.rowOrder[position]).toBe(created.rowKey);
    expect(state.documents.ships.totalRowCount).toBe(4);
    expect(hasCsvRowOrderChanges(state.documents.ships)).toBe(true);
    applyCsvDraftOperation(state.documents.ships, created, 'undo');
    expect(state.documents.ships.rowOrder).toEqual([0, 1, 2].map(key));
    applyCsvDraftOperation(state.documents.ships, created, 'redo');
    expect(state.documents.ships.rowOrder[position]).toBe(created.rowKey);
  });
  it('inserts consecutive rows after a selected record while unloaded identities retain their positions', () => {
    const { state } = fixture(6, [3]);
    state.selectedRowKey = key(3);
    const first = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyOperation!,
      second = createCsvRowDraft(state.documents.ships, first.rowKey, 2).historyOperation!;
    expect(state.documents.ships.rowOrder.slice(3, 7)).toEqual([key(3), first.rowKey, second.rowKey, key(4)]);
    expect(state.documents.ships.rows[key(4)]).toBeUndefined();
  });
  it('retains the record and data object when its temporary identity is accepted', () => {
    const { state } = fixture(1);
    const created = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyOperation!;
    const row = state.documents.ships.rows[created.rowKey]!,
      data = row.data;
    const order = [...state.documents.ships.rowOrder];
    const patches = [{ rowKey: created.rowKey, action: 'upsert' as const, row: { ...data }, isComment: false }];
    commitCsvTableSaveDraft(state.documents.ships, patches, [{ previousKey: created.rowKey, nextKey: key(9), rowIndex: 1 }], order);
    expect(state.documents.ships.rows[key(9)]).toBe(row);
    expect(row.data).toBe(data);
    expect(state.documents.ships.rowOrder).toEqual([key(0), key(9)]);
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(false);
  });
  it('retains a submitted creation undone during saving as a deletion against the saved baseline', () => {
    const { state } = fixture(1);
    const created = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyOperation!;
    if (created.type !== 'row-created') throw Error('fixture creates a row');
    const order = [...state.documents.ships.rowOrder];
    applyCsvDraftOperation(state.documents.ships, created, 'undo');
    commitCsvTableSaveDraft(
      state.documents.ships,
      [{ rowKey: created.rowKey, action: 'upsert', row: created.row.data, isComment: false }],
      [{ previousKey: created.rowKey, nextKey: key(9), rowIndex: 1 }],
      order,
    );
    expect(state.documents.ships.baselineRowOrder).toEqual([key(0), key(9)]);
    expect(state.documents.ships.rowOrder).toEqual([key(0)]);
    expect(state.documents.ships.dirty[key(9)]).toEqual({ action: 'delete' });
  });
  it('rebases a deletion undone during saving into a new identity at the retained position', () => {
    const { state } = fixture(3);
    state.selectedRowKey = key(1);
    const deletion = deleteCsvRowDraft(state.documents.ships, state.selectedRowKey!).historyOperation!;
    const order = [...state.documents.ships.rowOrder];
    applyCsvDraftOperation(state.documents.ships, deletion, 'undo');
    const mapped: CsvRowKeyMapping[] = [];
    commitCsvTableSaveDraft(state.documents.ships, [{ rowKey: key(1), action: 'delete', row: {}, isComment: false }], mapped, order);
    expect(state.documents.ships.rowOrder[1]).toContain(':new:');
    expect(state.documents.ships.rows[state.documents.ships.rowOrder[1]!]!.data.id).toBe('row-1');
    expect(mapped).toEqual([{ previousKey: key(1), nextKey: state.documents.ships.rowOrder[1], rowIndex: 1 }]);
    expect(state.documents.ships.baselineRowOrder).toEqual([key(0), key(2)]);
  });
  it('edits prototype-named business columns and keeps their exact dirty keys', () => {
    const { state } = fixture(1);
    replaceCsvTableDraft(state.documents.ships, [csvDraftRow(JSON.parse('{"id":"ship","__proto__":"original"}'), key(0))]);
    state.documents.ships.header = ['id', '__proto__', 'constructor'];
    expect(state.documents.ships.rows[key(0)]!.data.constructor).toBeUndefined();
    const edit = setCsvCellValueDraft(state.documents.ships, key(0), '__proto__', 'edited');
    expect(Object.hasOwn(state.documents.ships.rows[key(0)]!.data, '__proto__')).toBe(true);
    expect(state.documents.ships.dirty[key(0)]).toEqual({ action: 'upsert', cells: JSON.parse('{"__proto__":"edited"}') });
    applyCsvDraftOperation(state.documents.ships, edit.historyOperation!, 'undo');
    expect(state.documents.ships.rows[key(0)]!.data.__proto__).toBe('original');
    expect(state.documents.ships.dirty).toEqual({});
  });
  it('preserves quoted hash data, comment semantics and associated spec decisions', () => {
    const { state } = fixture(1);
    replaceCsvTableDraft(state.documents.ships, [csvDraftRow({ id: '#quoted', name: 'Name' }, key(0))]);
    const edit = setCsvCellValueDraft(state.documents.ships, key(0), 'id', '#disabled').historyOperation!;
    expect(state.documents.ships.rows[key(0)]!.isComment).toBe(true);
    applyCsvDraftOperation(state.documents.ships, edit, 'undo');
    expect(state.documents.ships.rows[key(0)]!.isComment).toBe(false);
    expect(state.documents.ships.dirty).toEqual({});
    applyCsvDraftOperation(state.documents.ships, edit, 'redo');
    expect(getAssociatedSpecCandidates(state.documents.ships, ['ships'])).toEqual([]);
    commitCsvTableSaveDraft(
      state.documents.ships,
      [{ rowKey: key(0), action: 'upsert', row: { id: '#quoted', name: 'Name' }, isComment: false }],
      [],
    );
    expect(state.documents.ships.rows[key(0)]!.isComment).toBe(true);
    expect(state.documents.ships.baselineRows[key(0)]!.isComment).toBe(false);
  });
  it('marks an external update while a raw input owns the original baseline', () => {
    const { state, index } = fixture(1);
    applyCsvTableRowsDraft(
      state.documents.ships,
      { table: 'ships', baseVersions: index.baseVersions, rows: [csvDraftRow({ id: 'changed' }, key(0))] },
      true,
    );
    expect(state.documents.ships.externalUpdatePending).toBe(true);
    expect(state.documents.ships.rows[key(0)]!.data.id).toBe('row-0');
  });
});
