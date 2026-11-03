import type {
  CsvDraftEdit,
  CsvSingleEdit,
  CsvRowKeyMapping,
  CsvRowPatch,
  CsvTableIndex,
  CsvTableRowsRead,
  CsvTableState,
  CsvDraftRow,
  CsvRowOrderEntry,
  DeepReadonly,
} from '@/shared/types';
import { cell, deepClone, rowDisplayId } from '@/shared/lib/starsector';
import { createCsvDeletedRow, createCsvDirtyCells, csvDirtyCells, hasCsvDirtyCells } from '@/domain/csv-editor/csv-dirty';
import { createTableRowKey } from '@/domain/csv-editor/table-row-key';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { retainLaterDraft } from '@/domain/edit-session';

export interface CsvDraftResult {
  changed: boolean;
  externalUpdateMarked?: boolean;
  historyLabel?: string;
  historyEdit?: CsvDraftEdit;
}
export interface CsvRowTarget {
  rowKey: string;
  rowIndex: number;
}
export function csvRowTargetOf(result: CsvDraftResult): CsvRowTarget | null {
  const edit = result.historyEdit;
  return edit && (edit.type === 'row-created' || edit.type === 'row-deleted') ? { rowKey: edit.rowKey, rowIndex: edit.rowIndex } : null;
}
function acceptsRows(state: CsvTableState, record: DeepReadonly<CsvTableRowsRead>, pending: boolean) {
  const known = new Map(state.baseVersions.map((version) => [version.path, version.fingerprint]));
  const sameVersions = record.baseVersions.every((version) => !known.has(version.path) || known.get(version.path) === version.fingerprint);
  const sameRows = record.rows.every((row) => {
    const original = state.baselineRows[row.rowKey];
    return !original || (original.isComment === row.isComment && stableDeepEqual(original.data, row.data));
  });
  if ((hasCsvTableDraftChanges(state) || pending) && (!sameVersions || !sameRows)) {
    state.externalUpdatePending = true;
    return false;
  }
  return true;
}
export function applyCsvTableIndexDraft(
  state: CsvTableState,
  record: DeepReadonly<CsvTableIndex>,
  filtered = false,
  pending = false,
): CsvDraftResult {
  if (!acceptsRows(state, record, pending)) return { changed: false, externalUpdateMarked: true };
  if (!filtered) {
    const known = new Map(state.baseVersions.map((version) => [version.path, version.fingerprint]));
    const changed =
      !stableDeepEqual(state.baselineRowOrder, record.rowKeys) ||
      record.baseVersions.some((version) => known.has(version.path) && known.get(version.path) !== version.fingerprint);
    if (changed && (hasCsvTableDraftChanges(state) || pending)) {
      state.externalUpdatePending = true;
      return { changed: false, externalUpdateMarked: true };
    }
    if (changed) {
      state.rows = {};
      state.baselineRows = {};
      state.baselineRowOrder = [...record.rowKeys];
      state.rowOrder = [...record.rowKeys];
    }
    delete state.queryRowKeys;
  } else state.queryRowKeys = [...record.rowKeys];
  if (!stableDeepEqual(state.header, record.header)) state.header = [...record.header];
  state.baseVersions = cloneQuerySnapshot<CsvTableIndex['baseVersions']>(record.baseVersions);
  acceptRows(state, record);
  updateCounts(state);
  return { changed: true };
}

export function acceptSavedCsvTableRows(state: CsvTableState, rows: DeepReadonly<CsvTableRowsRead['rows']>) {
  for (const entry of rows) {
    const before = state.baselineRows[entry.rowKey];
    const current = state.rows[entry.rowKey];
    if (current && before) {
      current.data = retainLaterDraft(current.data, before.data, cloneQuerySnapshot<CsvDraftRow['data']>(entry.data));
      current.isComment = retainLaterDraft(current.isComment, before.isComment, entry.isComment);
    } else if (!state.dirty[entry.rowKey]) state.rows[entry.rowKey] = cloneQuerySnapshot<CsvDraftRow>(entry);
    state.baselineRows[entry.rowKey] = cloneQuerySnapshot<CsvDraftRow>(entry);
  }
  rebuildDirty(state);
  updateCounts(state);
}

export function acceptSavedCsvTableIndex(state: CsvTableState, index: DeepReadonly<CsvTableIndex>, filtered = false) {
  acceptSavedCsvTableRows(state, index.rows);
  if (filtered) state.queryRowKeys ??= [...index.rowKeys];
  else {
    const moved = hasCsvRowOrderChanges(state);
    const formal = new Set(index.rowKeys);
    for (const key of Object.keys(state.baselineRows)) {
      if (formal.has(key)) continue;
      if (!state.dirty[key]) delete state.rows[key];
      delete state.baselineRows[key];
    }
    state.baselineRowOrder = [...index.rowKeys];
    if (!moved) state.rowOrder = [...index.rowKeys];
  }
  state.header = [...index.header];
  state.baseVersions = cloneQuerySnapshot<CsvTableIndex['baseVersions']>(index.baseVersions);
  rebuildDirty(state);
  state.externalUpdatePending = false;
  updateCounts(state);
}
export function applyCsvTableRowsDraft(state: CsvTableState, record: DeepReadonly<CsvTableRowsRead>, pending = false): CsvDraftResult {
  if (!acceptsRows(state, record, pending)) return { changed: false, externalUpdateMarked: true };
  const versions = new Map(state.baseVersions.map((version) => [version.path, version.fingerprint]));
  if (record.baseVersions.some((version) => versions.get(version.path) !== version.fingerprint)) {
    state.externalUpdatePending = true;
    return { changed: false, externalUpdateMarked: true };
  }
  acceptRows(state, record);
  return { changed: true };
}
function acceptRows(state: CsvTableState, record: DeepReadonly<CsvTableRowsRead>) {
  for (const entry of record.rows) {
    const original = state.baselineRows[entry.rowKey];
    if (!original) state.baselineRows[entry.rowKey] = cloneQuerySnapshot<CsvDraftRow>(entry);
    if (!state.rows[entry.rowKey] && state.dirty[entry.rowKey]?.action !== 'delete')
      state.rows[entry.rowKey] = cloneQuerySnapshot<CsvDraftRow>(entry);
  }
}
export function hasCsvTableDraftChanges(state: CsvTableState): boolean {
  return Object.keys(state.dirty).length > 0 || hasCsvRowOrderChanges(state);
}
export function hasCsvRowOrderChanges(state: CsvTableState): boolean {
  return !stableDeepEqual(state.rowOrder, state.baselineRowOrder);
}
export function csvVisibleRowKeys(state: CsvTableState) {
  return state.queryRowKeys ?? state.rowOrder;
}
export function moveCsvRowDraft(state: CsvTableState, rowKey: string, nextIndex: number): CsvDraftResult {
  const tab = state.table;
  const order = state.rowOrder,
    previousIndex = order.indexOf(rowKey);
  if (previousIndex < 0 || previousIndex === nextIndex) return { changed: false };
  order.splice(previousIndex, 1);
  order.splice(nextIndex, 0, rowKey);
  return {
    changed: true,
    historyLabel: '移动 ' + tab + ' 行',
    historyEdit: { type: 'row-moved', tab, rowKey, previousIndex, nextIndex },
  };
}
export function markCsvTableExternalUpdateDraft(state: CsvTableState): void {
  state.externalUpdatePending = true;
}
export function clearCsvTableExternalUpdateDraft(state: CsvTableState): void {
  state.externalUpdatePending = false;
}
export function setCsvCellValueDraft(state: CsvTableState, rowKey: string, col: string, value: string): CsvDraftResult {
  const tab = state.table;
  const row = state.rows[rowKey];
  if (!row) return { changed: false };
  const previousValue = cell(row.data[col]),
    previousIsComment = row.isComment;
  row.data[col] = value;
  if (col === state.header[0] && value !== previousValue) {
    const original = state.baselineRows[rowKey];
    row.isComment = original && value === cell(original.data[col]) ? original.isComment : value.startsWith('#');
  }
  refreshCellDirty(state, row, col);
  return value === previousValue
    ? { changed: true }
    : {
        changed: true,
        historyLabel: '编辑 ' + tab + ' [' + col + ']',
        historyEdit: {
          type: 'cell-value-set',
          tab,
          rowKey,
          col,
          previousValue,
          newValue: value,
          previousIsComment,
          newIsComment: row.isComment,
        },
      };
}
export function createCsvRowDraft(state: CsvTableState, selectedRowKey: string | null, now: number): CsvDraftResult {
  const tab = state.table,
    visible = csvVisibleRowKeys(state);
  const selectedIndex = selectedRowKey === null ? -1 : state.rowOrder.indexOf(selectedRowKey);
  const rowIndex = selectedIndex < 0 ? state.rowOrder.length : selectedIndex + 1;
  const id = 'new_' + tab + '_' + now;
  const row: CsvDraftRow = {
    rowKey: createTableRowKey(state.table, state.nextRowKey++),
    data: Object.fromEntries(state.header.map((col) => [col, ''])),
    isComment: false,
  };
  if ('id' in row.data) row.data.id = id;
  if ('name' in row.data) row.data.name = id;
  state.rows[row.rowKey] = row;
  state.rowOrder.splice(rowIndex, 0, row.rowKey);
  if (state.queryRowKeys) {
    const index = selectedRowKey ? visible.indexOf(selectedRowKey) : -1;
    visible.splice(index < 0 ? visible.length : index + 1, 0, row.rowKey);
  }
  markRowDirty(state, row);
  updateCounts(state);
  return {
    changed: true,
    historyLabel: '新建 ' + tab + ' 行: ' + id,
    historyEdit: { type: 'row-created', tab, rowKey: row.rowKey, rowIndex, row: deepClone(row) },
  };
}
export function deleteCsvRowDraft(state: CsvTableState, rowKey: string): CsvDraftResult {
  const tab = state.table;
  const row = state.rows[rowKey],
    rowIndex = state.rowOrder.indexOf(rowKey);
  if (!row || rowIndex < 0) return { changed: false };
  const result = {
    changed: true,
    historyLabel: '删除 ' + tab + ' 行: ' + (rowDisplayId(row.data) || '第 ' + (rowIndex + 1) + ' 行'),
    historyEdit: { type: 'row-deleted' as const, tab, rowKey, rowIndex, row: deepClone(row) },
  };
  removeRow(state, rowKey);
  return result;
}
export function writeCsvRangeDraft(state: CsvTableState, rowKeys: string[], columns: string[], values: string[][]): CsvDraftResult {
  const edits: CsvSingleEdit[] = [];
  for (let index = 0; index < values.length; index++) {
    if (!rowKeys[index]) {
      const row: CsvDraftRow = {
        rowKey: createTableRowKey(state.table, state.nextRowKey++),
        data: Object.fromEntries(state.header.map((key) => [key, ''])),
        isComment: false,
      };
      const edit: CsvSingleEdit = {
        type: 'row-created',
        tab: state.table,
        rowKey: row.rowKey,
        rowIndex: state.rowOrder.length,
        row: deepClone(row),
      };
      applyCsvDraftEdit(state, edit, 'redo');
      edits.push(edit);
      rowKeys.push(row.rowKey);
    }
    for (let col = 0; col < columns.length; col++) {
      const result = setCsvCellValueDraft(state, rowKeys[index]!, columns[col]!, values[index]![col]!);
      if (result.historyEdit?.type === 'cell-value-set') edits.push(result.historyEdit);
    }
  }
  return edits.length
    ? {
        changed: true,
        historyLabel: '批量编辑 ' + state.table,
        historyEdit: { type: 'batch', tab: state.table, rowKey: rowKeys[0]!, edits },
      }
    : { changed: false };
}
function csvRowBatch(state: CsvTableState, edits: CsvSingleEdit[], label: string): CsvDraftResult {
  return edits.length
    ? {
        changed: true,
        historyLabel: label + ' ' + state.table + ' 行',
        historyEdit: { type: 'batch', tab: state.table, rowKey: edits[0]!.rowKey, edits },
      }
    : { changed: false };
}
export function moveCsvRowsDraft(state: CsvTableState, keys: string[], boundary: number): CsvDraftResult {
  const selected = new Set(keys),
    order = state.rowOrder;
  const moving = order.filter((key) => selected.has(key));
  const remaining = order.filter((key) => !selected.has(key));
  const position = boundary - order.slice(0, boundary).filter((key) => selected.has(key)).length;
  const next = [...remaining.slice(0, position), ...moving, ...remaining.slice(position)];
  if (next.every((key, index) => key === order[index])) return { changed: false };
  const edits: CsvSingleEdit[] = [];
  const move = (key: string, index: number) => {
    const result = moveCsvRowDraft(state, key, index);
    if (result.historyEdit?.type === 'row-moved') edits.push(result.historyEdit);
  };
  // Vacate the selected records before placing the group; history grows with the group size.
  moving.forEach((key) => move(key, order.length - 1));
  moving.forEach((key, offset) => move(key, position + offset));
  return csvRowBatch(state, edits, '移动');
}
export function insertCsvRowsDraft(
  state: CsvTableState,
  rows: CsvDraftRow[],
  boundary: number,
): { result: CsvDraftResult; keys: string[] } {
  const edits: CsvSingleEdit[] = [],
    keys: string[] = [];
  rows.forEach((source, offset) => {
    const row = { rowKey: createTableRowKey(state.table, state.nextRowKey++), data: deepClone(source.data), isComment: source.isComment };
    const edit: CsvSingleEdit = { type: 'row-created', tab: state.table, rowKey: row.rowKey, rowIndex: boundary + offset, row };
    applyCsvDraftEdit(state, edit, 'redo');
    edits.push(edit);
    keys.push(row.rowKey);
  });
  return { result: csvRowBatch(state, edits, '插入'), keys };
}
export function deleteCsvRowsDraft(state: CsvTableState, keys: string[]): CsvDraftResult {
  const edits: CsvSingleEdit[] = [];
  for (const key of keys) {
    const result = deleteCsvRowDraft(state, key);
    if (result.historyEdit?.type === 'row-deleted') edits.push(result.historyEdit);
  }
  return csvRowBatch(state, edits, '删除');
}
export function applyCsvDraftEdit(state: CsvTableState, edit: CsvDraftEdit, direction: 'undo' | 'redo'): boolean {
  if (edit.type === 'batch') {
    // Undo cell edits before removing rows created by the same edit.
    const edits = direction === 'undo' ? [...edit.edits].reverse() : edit.edits;
    return edits.every((entry) => applyCsvDraftEdit(state, entry, direction));
  }
  const { rowKey } = edit;
  if (edit.type === 'row-moved') return moveCsvRowDraft(state, rowKey, direction === 'undo' ? edit.previousIndex : edit.nextIndex).changed;
  if (edit.type === 'cell-value-set') {
    const row = state.rows[rowKey];
    if (!row) return false;
    row.data[edit.col] = direction === 'undo' ? edit.previousValue : edit.newValue;
    if (edit.col === state.header[0]) row.isComment = direction === 'undo' ? edit.previousIsComment : edit.newIsComment;
    refreshCellDirty(state, row, edit.col);
    return true;
  }
  if ((edit.type === 'row-created') === (direction === 'undo')) return removeRow(state, rowKey);
  if (state.rowOrder.includes(rowKey)) return true;
  const row = deepClone(edit.row);
  row.rowKey = rowKey;
  state.rows[rowKey] = row;
  state.rowOrder.splice(edit.rowIndex, 0, rowKey);
  if (state.queryRowKeys) {
    const next = state.rowOrder.slice(edit.rowIndex + 1).find((key) => state.queryRowKeys!.includes(key));
    state.queryRowKeys.splice(next ? state.queryRowKeys.indexOf(next) : state.queryRowKeys.length, 0, rowKey);
  }
  markRowDirty(state, row);
  updateCounts(state);
  return true;
}
function removeRow(state: CsvTableState, rowKey: string) {
  const index = state.rowOrder.indexOf(rowKey);
  if (index < 0) return false;
  state.rowOrder.splice(index, 1);
  const query = state.queryRowKeys;
  if (query) {
    const index = query.indexOf(rowKey);
    if (index >= 0) query.splice(index, 1);
  }
  delete state.rows[rowKey];
  if (state.baselineRowOrder.includes(rowKey)) state.dirty[rowKey] = createCsvDeletedRow();
  else delete state.dirty[rowKey];
  updateCounts(state);
  return true;
}
export function discardCsvTableWindowForReloadDraft(state: CsvTableState): void {
  state.rows = deepClone(state.baselineRows);
  state.rowOrder = [...state.baselineRowOrder];
  state.dirty = {};
  state.externalUpdatePending = false;
  updateCounts(state);
}
export function markCsvTableSavedDraft(state: CsvTableState): void {
  state.baselineRows = deepClone(state.rows);
  state.baselineRowOrder = [...state.rowOrder];
  state.dirty = {};
  state.externalUpdatePending = false;
}
export function replaceCsvTableDraft(state: CsvTableState, rows: CsvDraftRow[]): void {
  state.rows = Object.fromEntries(rows.map((row) => [row.rowKey, deepClone(row)]));
  state.rowOrder = rows.map((row) => row.rowKey);
  delete state.queryRowKeys;
  markCsvTableSavedDraft(state);
  updateCounts(state);
}
export function applySavedCsvRowKeyMapDraft(state: CsvTableState, keyMap: CsvRowKeyMapping[]): void {
  const mapped = new Map(keyMap.map((entry) => [entry.previousKey, entry.nextKey]));
  for (const rows of [state.rows, state.baselineRows]) {
    for (const { previousKey, nextKey } of keyMap) {
      const row = rows[previousKey];
      if (!row || previousKey === nextKey) continue;
      delete rows[previousKey];
      row.rowKey = nextKey;
      rows[nextKey] = row;
    }
  }
  for (const order of [state.rowOrder, state.baselineRowOrder, state.queryRowKeys]) {
    if (order) for (let index = 0; index < order.length; index++) order[index] = mapped.get(order[index]!) ?? order[index]!;
  }
  for (const { previousKey, nextKey } of keyMap) {
    const dirty = state.dirty[previousKey];
    if (dirty && previousKey !== nextKey) {
      delete state.dirty[previousKey];
      state.dirty[nextKey] = dirty;
    }
  }
}
export function commitCsvTableSaveDraft(
  state: CsvTableState,
  patches: CsvRowPatch[],
  keyMap: CsvRowKeyMapping[],
  submittedOrder: CsvRowOrderEntry[] | null = null,
) {
  const savedOrder = [...(submittedOrder ?? state.baselineRowOrder)];
  const original = state.baselineRows;
  for (const patch of patches) {
    if (patch.action === 'delete') delete original[patch.rowKey];
    else original[patch.rowKey] = { rowKey: patch.rowKey, data: deepClone(patch.row), isComment: patch.isComment };
  }
  applySavedCsvRowKeyMapDraft(state, keyMap);
  const mapped = new Map(keyMap.map((entry) => [entry.previousKey, entry.nextKey]));
  state.baselineRowOrder = savedOrder.map((key) => mapped.get(key) ?? key);
  for (const patch of patches) {
    if (patch.action !== 'delete' || !state.rows[patch.rowKey]) continue;
    const nextKey = createTableRowKey(state.table, state.nextRowKey++);
    const mapping = { previousKey: patch.rowKey, nextKey, rowIndex: state.rowOrder.indexOf(patch.rowKey) };
    keyMap.push(mapping);
    applySavedCsvRowKeyMapDraft(state, [mapping]);
  }
  rebuildDirty(state);
  state.externalUpdatePending = false;
  updateCounts(state);
}
function updateCounts(state: CsvTableState) {
  state.totalRowCount = state.rowOrder.length;
  state.filteredRowCount = csvVisibleRowKeys(state).length;
}
function refreshCellDirty(state: CsvTableState, row: CsvDraftRow, col: string) {
  const original = state.baselineRows[row.rowKey],
    value = cell(row.data[col]);
  if (value !== cell(original?.data[col]) || (col === state.header[0] && row.isComment !== original?.isComment)) {
    ensureDirtyCells(state, row.rowKey)[col] = value;
  } else {
    const cells = csvDirtyCells(state.dirty[row.rowKey]);
    if (cells) delete cells[col];
    if (original && !hasCsvDirtyCells(state.dirty[row.rowKey])) delete state.dirty[row.rowKey];
  }
}
function ensureDirtyCells(state: CsvTableState, rowKey: string) {
  state.dirty[rowKey] ??= createCsvDirtyCells();
  return csvDirtyCells(state.dirty[rowKey])!;
}
function markRowDirty(state: CsvTableState, row: CsvDraftRow) {
  delete state.dirty[row.rowKey];
  if (!state.baselineRows[row.rowKey]) state.dirty[row.rowKey] = createCsvDirtyCells();
  for (const key of Object.keys(row.data)) refreshCellDirty(state, row, key);
}
function rebuildDirty(state: CsvTableState) {
  state.dirty = {};
  const current = new Set(state.rowOrder);
  for (const row of Object.values(state.rows)) markRowDirty(state, row);
  for (const rowKey of state.baselineRowOrder) if (!current.has(rowKey)) state.dirty[rowKey] = createCsvDeletedRow();
}
