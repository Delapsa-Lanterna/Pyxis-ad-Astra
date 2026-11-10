import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { csvDraftRow, csvTableIndex } from '@/test/fixtures/csv-row';
import {
  applyCsvDraftEdit,
  applyCsvTableIndexDraft,
  acceptSavedCsvTableIndex,
  applyCsvTableRowsDraft,
  commitCsvTableSaveDraft,
  createCsvRowDraft,
  setCsvCellValueDraft,
  writeCsvRangeDraft,
  moveCsvRowsDraft,
  insertCsvRowsDraft,
  deleteCsvRowsDraft,
  moveCsvRowDraft,
  hasCsvRowOrderChanges,
  hasCsvTableDraftChanges,
  deleteCsvRowDraft,
  replaceCsvTableDraft,
} from './csv-table-draft';
import { getAssociatedSpecCandidates } from './associated-spec-candidates';
import { appLogQueue } from '@/shared/runtime/app-log-queue';
import { ref } from 'vue';
import type { AppLogEntry, CsvRowKeyMapping } from '@/shared/types';
beforeEach(() => setActivePinia(createPinia()));
const key = (index: number) => 'ships:row:' + index;
function fixture(count = 6, loaded = Array.from({ length: count }, (_, index) => index)) {
  const tables = useCsvEditorStore(),
    manifest = sessionUpdateFixture('session', 'M:/mod').content.manifest;
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
  it('retains unchanged visible rows and order while replacing changed rows and evicting unverified old content', () => {
    const { state, index } = fixture(6, [0, 2, 4]);
    const document = state.documents.ships;
    const unchanged = document.rows[key(2)],
      baseline = document.baselineRows[key(2)],
      order = document.rowOrder;
    const changed = csvDraftRow({ id: 'row-0', name: 'Updated' }, key(0));
    const fresh = csvTableIndex([changed, csvDraftRow({ id: 'row-2', name: 'Name 2' }, key(2))], {
      rowKeys: index.rowKeys,
      totalRows: index.totalRows,
      header: index.header,
      baseVersions: [{ path: 'ships.csv', fingerprint: 'updated' }],
      validationRows: index.validationRows.map((row) => (row.rowKey === key(0) ? changed : row)),
    });
    applyCsvTableIndexDraft(document, fresh);
    expect(document.rows[key(2)]).toBe(unchanged);
    expect(document.baselineRows[key(2)]).toBe(baseline);
    expect(document.rowOrder).toBe(order);
    expect(document.rows[key(0)]?.data.name).toBe('Updated');
    expect(document.rows[key(4)]).toBeUndefined();
    document.rows[key(0)]!.data.name = 'Local';
    expect(document.baselineRows[key(0)]?.data.name).toBe('Updated');
  });
  it('records each deleted identity and its undo and redo under one history identity', async () => {
    fixture(6);
    const records: AppLogEntry[] = [];
    appLogQueue.install(async (batch) => {
      records.push(...batch);
    }, vi.fn());
    const tables = useCsvEditorStore(),
      target = { sessionId: 'session', modRoot: 'M:/mod', table: 'ships' as const };
    const editor = tables.bindSaveActions(target, {
      saving: ref(false),
      save: async () => ({ status: 'noop' }),
      waitForSave: async () => true,
    });
    tables.deleteRows(target, [key(0), key(2)]);
    await editor.undo();
    await editor.redo();
    await appLogQueue.flush();
    const events = records.filter((entry) => entry.code?.startsWith('tables.'));
    expect(events.map((entry) => [entry.code, entry.fields?.id])).toEqual([
      ['tables.row_deleted', 'row-0'],
      ['tables.row_deleted', 'row-2'],
      ['tables.undo', 'row-0'],
      ['tables.undo', 'row-2'],
      ['tables.redo', 'row-0'],
      ['tables.redo', 'row-2'],
    ]);
    expect(new Set(events.map((entry) => entry.fields?.operationId)).size).toBe(1);
    expect(events.every((entry) => entry.fields?.sessionId === 'session' && entry.fields.modRoot === 'M:/mod')).toBe(true);
    tables.updateCellValue({ ...target, rowKey: key(1), column: 'id' }, 'renamed');
    await editor.undo();
    await appLogQueue.flush();
    expect(records.at(-1)!.fields).toMatchObject({ previousId: 'renamed', nextId: 'row-1' });
    tables.moveRows(target, [key(1), key(4)], 4);
    await editor.undo();
    await appLogQueue.flush();
    expect(records.at(-1)!.fields).toMatchObject({ id: 'row-4', previousIndex: '3', nextIndex: '2' });
  });
  it.each([0, 2, 6])('moves disjoint rows together at boundary %s and reverses exactly', (boundary) => {
    const { state } = fixture(6),
      document = state.documents.ships;
    const selected = [key(1), key(4)],
      remaining = [0, 2, 3, 5].map(key);
    const at = boundary - [1, 4].filter((index) => index < boundary).length;
    const result = moveCsvRowsDraft(document, selected, boundary);
    expect(document.rowOrder).toEqual([...remaining.slice(0, at), ...selected, ...remaining.slice(at)]);
    applyCsvDraftEdit(document, result.historyEdit!, 'undo');
    expect(document.rowOrder).toEqual([0, 1, 2, 3, 4, 5].map(key));
    expect(hasCsvTableDraftChanges(document)).toBe(false);
    applyCsvDraftEdit(document, result.historyEdit!, 'redo');
    expect(document.rowOrder.slice(at, at + 2)).toEqual(selected);
  });
  it('treats an unchanged group position as no history edit', () => {
    const { state } = fixture(4);
    expect(moveCsvRowsDraft(state.documents.ships, [key(1), key(2)], 2).changed).toBe(false);
  });
  it('moves unloaded rows with history proportional to the chosen group', () => {
    const { state } = fixture(300, []),
      document = state.documents.ships;
    const single = moveCsvRowsDraft(document, [key(0)], 300).historyEdit!;
    if (single.type !== 'batch') throw Error('expected batch');
    expect(single.edits).toHaveLength(1);
    expect(document.rowOrder.at(-1)).toBe(key(0));
    applyCsvDraftEdit(document, single, 'undo');
    const group = moveCsvRowsDraft(document, [key(0), key(2)], 300).historyEdit!;
    if (group.type !== 'batch') throw Error('expected batch');
    expect(group.edits.length).toBeLessThanOrEqual(4);
    expect(document.rowOrder.slice(-2)).toEqual([key(0), key(2)]);
    expect(Object.keys(document.rows)).toHaveLength(0);
    applyCsvDraftEdit(document, group, 'undo');
    expect(document.rowOrder).toEqual(Array.from({ length: 300 }, (_, index) => key(index)));
  });
  it('inserts independent copies before a filtered target and replays their visibility', () => {
    const { state } = fixture(6),
      document = state.documents.ships;
    document.queryRowKeys = [key(1), key(4)];
    document.filteredRowCount = 2;
    const rows = [document.rows[key(1)]!, document.rows[key(4)]!];
    const { result, keys } = insertCsvRowsDraft(document, rows, 4);
    expect(document.queryRowKeys).toEqual([key(1), ...keys, key(4)]);
    expect(document.rowOrder).toEqual([0, 1, 2, 3].map(key).concat(keys, [key(4), key(5)]));
    expect(document.rows[keys[0]!]!.isComment).toBe(true);
    expect(document.rows[keys[0]!]!.data).not.toBe(rows[0]!.data);
    applyCsvDraftEdit(document, result.historyEdit!, 'undo');
    expect(document.totalRowCount).toBe(6);
    applyCsvDraftEdit(document, result.historyEdit!, 'redo');
    expect(document.queryRowKeys).toEqual([key(1), ...keys, key(4)]);
  });
  it('deletes disjoint records with comments as one reversible history item', () => {
    const { state } = fixture(6),
      document = state.documents.ships;
    const result = deleteCsvRowsDraft(document, [key(1), key(4)]);
    expect(document.rowOrder).toEqual([0, 2, 3, 5].map(key));
    expect(result.historyEdit?.type).toBe('batch');
    applyCsvDraftEdit(document, result.historyEdit!, 'undo');
    expect(document.rowOrder).toEqual([0, 1, 2, 3, 4, 5].map(key));
    expect(document.rows[key(1)]!.isComment).toBe(true);
    expect(document.dirty).toEqual({});
  });
  it('groups a filtered paste and appended blank rows into one reversible edit', () => {
    const { state } = fixture(4),
      document = state.documents.ships;
    document.queryRowKeys = [key(0), key(2)];
    const keys = [key(2)];
    const result = writeCsvRangeDraft(document, keys, ['name'], [['001'], [''], ['quoted\ntext']]);
    expect(keys).toHaveLength(3);
    expect(document.rowOrder).toEqual([key(0), key(1), key(2), key(3), keys[1], keys[2]]);
    expect(document.queryRowKeys).toEqual([key(0), key(2), keys[1], keys[2]]);
    expect(document.rows[key(1)]!.data.name).toBe('Name 1');
    expect(document.rows[keys[1]!]!.data).toEqual({ id: '', name: '' });
    expect(document.rows[keys[2]!]!.data).toEqual({ id: '', name: 'quoted\ntext' });
    expect(document.totalRowCount).toBe(6);
    applyCsvDraftEdit(document, result.historyEdit!, 'undo');
    expect(document.rowOrder).toEqual([0, 1, 2, 3].map(key));
    expect(document.queryRowKeys).toEqual([key(0), key(2)]);
    expect(document.dirty).toEqual({});
    applyCsvDraftEdit(document, result.historyEdit!, 'redo');
    expect(document.totalRowCount).toBe(6);
    expect(document.rows[key(2)]!.data.name).toBe('001');
  });
  it('replays comment identity exactly and ignores unchanged batch values', () => {
    const { state } = fixture(2),
      document = state.documents.ships;
    const result = writeCsvRangeDraft(document, [key(0), key(1)], ['id'], [['#disabled'], ['enabled']]);
    expect(document.rows[key(0)]!.isComment).toBe(true);
    expect(document.rows[key(1)]!.isComment).toBe(false);
    expect(writeCsvRangeDraft(document, [key(0), key(1)], ['id'], [['#disabled'], ['enabled']]).historyEdit).toBeUndefined();
    applyCsvDraftEdit(document, result.historyEdit!, 'undo');
    expect(document.rows[key(0)]!.isComment).toBe(false);
    expect(document.rows[key(1)]!.isComment).toBe(true);
    expect(document.dirty).toEqual({});
  });
  it('maps every member of a saved batch while retaining subsequent raw values', () => {
    const { state } = fixture(1),
      document = state.documents.ships,
      tables = useCsvEditorStore();
    const target = { sessionId: 'session', modRoot: 'M:/mod', table: 'ships' as const };
    const keys = tables.updateRange(target, [key(0)], ['name'], [['A'], ['B']]);
    const order = [...document.rowOrder];
    const patches = keys.map((rowKey) => ({
      rowKey,
      action: 'upsert' as const,
      row: { ...document.rows[rowKey]!.data },
      columns: Object.keys(document.rows[rowKey]!.data),
      commentChanged: false,
      isComment: false,
    }));
    setCsvCellValueDraft(document, keys[1]!, 'name', 'Later');
    const mapping = [{ previousKey: keys[1]!, nextKey: key(9), rowIndex: 1 }];
    commitCsvTableSaveDraft(document, patches, mapping, order);
    tables.applySavedRowKeyMap(target.modRoot, target.table, mapping);
    expect(document.rows[key(9)]!.data.name).toBe('Later');
    const batch = document.history.undoStack[0]!.edit;
    if (batch.type !== 'batch') throw Error('expected batch');
    expect(batch.edits.filter((edit) => edit.rowKey === keys[1])).toHaveLength(0);
    expect(batch.edits.filter((edit) => edit.rowKey === key(9))).toHaveLength(2);
    applyCsvDraftEdit(document, batch, 'undo');
    expect(document.dirty[key(9)]).toEqual({ action: 'delete' });
    applyCsvDraftEdit(document, batch, 'redo');
    expect(document.rows[key(9)]!.data.name).toBe('B');
  });
  it.each([0, 1, 2, 3].flatMap((position) => [false, true].map((comment) => ({ position, comment }))))(
    'copies complete independent rows to $position with comment=$comment through history',
    ({ position, comment }) => {
      const { state } = fixture(3),
        document = state.documents.ships;
      const source = document.rows[key(1)]!;
      source.data.extra = '001';
      source.isComment = comment;
      const edit = insertCsvRowsDraft(document, [source], position).result.historyEdit!;
      const copy = document.rows[edit.rowKey]!;
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
      applyCsvDraftEdit(document, edit, 'undo');
      expect(document.rowOrder).toEqual([0, 1, 2].map(key));
      applyCsvDraftEdit(document, edit, 'redo');
      expect(document.rowOrder[position]).toBe(copy.rowKey);
      expect(document.rows[copy.rowKey]!.data.extra).toBe('001');
    },
  );
  it('selects consecutive copies and accepts saved identities into their order and history', () => {
    const { state } = fixture(2),
      document = state.documents.ships,
      tables = useCsvEditorStore();
    const target = { sessionId: 'session', modRoot: 'M:/mod', table: 'ships' as const };
    const first = tables.copyRows(target, [key(1)], 0)[0]!;
    const second = tables.copyRows(target, [first], 1)[0]!;
    tables.selectRowByKey(target, second);
    expect(first).not.toBe(second);
    expect(document.rowOrder).toEqual([first, second, key(0), key(1)]);
    expect(document.history.undoStack).toHaveLength(2);
    const order = [...document.rowOrder];
    const patches = [first, second].map((rowKey) => ({
      rowKey,
      action: 'upsert' as const,
      row: { ...document.rows[rowKey]!.data },
      columns: Object.keys(document.rows[rowKey]!.data),
      commentChanged: false,
      isComment: true,
    }));
    const mapping = [first, second].map((previousKey, rowIndex) => ({ previousKey, nextKey: key(8 + rowIndex), rowIndex }));
    commitCsvTableSaveDraft(document, patches, mapping, order);
    tables.applySavedRowKeyMap(target.modRoot, target.table, mapping);
    expect(document.rowOrder).toEqual([key(8), key(9), key(0), key(1)]);
    expect(state.selectedRowKey).toBe(key(9));
    expect(document.history.undoStack.map((entry) => entry.edit.rowKey)).toEqual([key(8), key(9)]);
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
    const edit = moveCsvRowDraft(state.documents.ships, key(from), to).historyEdit!;
    expect(state.documents.ships.rows[key(from)]).toBe(row);
    expect(state.documents.ships.rowOrder[to]).toBe(key(from));
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(true);
    expect(state.documents.ships.dirty).toEqual({});
    applyCsvDraftEdit(state.documents.ships, edit, 'undo');
    expect(state.documents.ships.rowOrder).toEqual(Array.from({ length: 6 }, (_, index) => key(index)));
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(false);
    applyCsvDraftEdit(state.documents.ships, edit, 'redo');
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
    const moved = moveCsvRowDraft(state.documents.ships, key(4), 0).historyEdit!;
    const created = createCsvRowDraft(state.documents.ships, moved.rowKey, 1).historyEdit!;
    state.selectedRowKey = key(1);
    const deleted = deleteCsvRowDraft(state.documents.ships, state.selectedRowKey!).historyEdit!;
    expect(state.documents.ships.rowOrder).toEqual([key(4), created.rowKey, key(0), key(2), key(3), key(5)]);
    for (const edit of [deleted, created, moved]) applyCsvDraftEdit(state.documents.ships, edit, 'undo');
    expect(state.documents.ships.rowOrder).toEqual(Array.from({ length: 6 }, (_, index) => key(index)));
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(false);
    for (const edit of [moved, created, deleted]) applyCsvDraftEdit(state.documents.ships, edit, 'redo');
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
    const moved = moveCsvRowDraft(state.documents.ships, key(5), 0).historyEdit!;
    const submitted = [...state.documents.ships.rowOrder];
    applyCsvDraftEdit(state.documents.ships, moved, 'undo');
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
    const created = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyEdit!;
    const position = selected === null ? 3 : selected + 1;
    expect(state.documents.ships.rowOrder[position]).toBe(created.rowKey);
    expect(state.documents.ships.totalRowCount).toBe(4);
    expect(hasCsvRowOrderChanges(state.documents.ships)).toBe(true);
    applyCsvDraftEdit(state.documents.ships, created, 'undo');
    expect(state.documents.ships.rowOrder).toEqual([0, 1, 2].map(key));
    applyCsvDraftEdit(state.documents.ships, created, 'redo');
    expect(state.documents.ships.rowOrder[position]).toBe(created.rowKey);
  });
  it('inserts consecutive rows after a selected record while unloaded identities retain their positions', () => {
    const { state } = fixture(6, [3]);
    state.selectedRowKey = key(3);
    const first = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyEdit!,
      second = createCsvRowDraft(state.documents.ships, first.rowKey, 2).historyEdit!;
    expect(state.documents.ships.rowOrder.slice(3, 7)).toEqual([key(3), first.rowKey, second.rowKey, key(4)]);
    expect(state.documents.ships.rows[key(4)]).toBeUndefined();
  });
  it('retains the record and data object when its temporary identity is accepted', () => {
    const { state } = fixture(1);
    const created = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyEdit!;
    const row = state.documents.ships.rows[created.rowKey]!,
      data = row.data;
    const order = [...state.documents.ships.rowOrder];
    const patches = [
      {
        rowKey: created.rowKey,
        action: 'upsert' as const,
        row: { ...data },
        columns: Object.keys(data),
        commentChanged: false,
        isComment: false,
      },
    ];
    commitCsvTableSaveDraft(state.documents.ships, patches, [{ previousKey: created.rowKey, nextKey: key(9), rowIndex: 1 }], order);
    expect(state.documents.ships.rows[key(9)]).toBe(row);
    expect(row.data).toBe(data);
    expect(state.documents.ships.rowOrder).toEqual([key(0), key(9)]);
    expect(hasCsvTableDraftChanges(state.documents.ships)).toBe(false);
  });
  it('retains a submitted creation undone during saving as a deletion against the saved baseline', () => {
    const { state } = fixture(1);
    const created = createCsvRowDraft(state.documents.ships, state.selectedRowKey, 1).historyEdit!;
    if (created.type !== 'row-created') throw Error('fixture creates a row');
    const order = [...state.documents.ships.rowOrder];
    applyCsvDraftEdit(state.documents.ships, created, 'undo');
    commitCsvTableSaveDraft(
      state.documents.ships,
      [
        {
          rowKey: created.rowKey,
          action: 'upsert',
          row: created.row.data,
          columns: Object.keys(created.row.data),
          commentChanged: false,
          isComment: false,
        },
      ],
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
    const deletion = deleteCsvRowDraft(state.documents.ships, state.selectedRowKey!).historyEdit!;
    const order = [...state.documents.ships.rowOrder];
    applyCsvDraftEdit(state.documents.ships, deletion, 'undo');
    const mapped: CsvRowKeyMapping[] = [];
    commitCsvTableSaveDraft(
      state.documents.ships,
      [{ rowKey: key(1), action: 'delete', row: {}, columns: [], commentChanged: false, isComment: false }],
      mapped,
      order,
    );
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
    applyCsvDraftEdit(state.documents.ships, edit.historyEdit!, 'undo');
    expect(state.documents.ships.rows[key(0)]!.data.__proto__).toBe('original');
    expect(state.documents.ships.dirty).toEqual({});
  });
  it('preserves quoted hash data, comment semantics and associated spec decisions', () => {
    const { state } = fixture(1);
    replaceCsvTableDraft(state.documents.ships, [csvDraftRow({ id: '#quoted', name: 'Name' }, key(0))]);
    const edit = setCsvCellValueDraft(state.documents.ships, key(0), 'id', '#disabled').historyEdit!;
    expect(state.documents.ships.rows[key(0)]!.isComment).toBe(true);
    applyCsvDraftEdit(state.documents.ships, edit, 'undo');
    expect(state.documents.ships.rows[key(0)]!.isComment).toBe(false);
    expect(state.documents.ships.dirty).toEqual({});
    applyCsvDraftEdit(state.documents.ships, edit, 'redo');
    expect(getAssociatedSpecCandidates(state.documents.ships, ['ships'])).toEqual([]);
    commitCsvTableSaveDraft(
      state.documents.ships,
      [
        {
          rowKey: key(0),
          action: 'upsert',
          row: { id: '#quoted', name: 'Name' },
          columns: ['id', 'name'],
          commentChanged: false,
          isComment: false,
        },
      ],
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
