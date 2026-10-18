import type {
  CsvDraftOperation,
  CsvRowKeyMapping,
  CsvRowPatch,
  CsvTableIndex,
  CsvTableRowsRead,
  ModTableState,
  CsvDraftRow,
  CsvTableKey,
  CsvRowOrderEntry,
  DeepReadonly,
} from '@/shared/types';
import { cell, deepClone, rowDisplayId } from '@/shared/lib/starsector';
import { createCsvDeletedRow, createCsvDirtyCells, csvDirtyCells, hasCsvDirtyCells } from '@/domain/tables/csv-dirty';
import { createTableRowKey } from '@/domain/tables/table-row-key';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

export interface CsvDraftResult {
  changed: boolean;
  externalUpdateMarked?: boolean;
  historyLabel?: string;
  historyOperation?: CsvDraftOperation;
}
export interface CsvRowTarget {
  rowKey: string;
  rowIndex: number;
}
export function csvRowTargetOf(result: CsvDraftResult): CsvRowTarget | null {
  const operation = result.historyOperation;
  return operation && (operation.type === 'row-created' || operation.type === 'row-deleted')
    ? { rowKey: operation.rowKey, rowIndex: operation.rowIndex }
    : null;
}
function acceptsRows(state: ModTableState, record: DeepReadonly<CsvTableRowsRead>, pending: boolean) {
  const known = new Map(state.baseVersions[record.table].map((version) => [version.path, version.fingerprint]));
  const sameVersions = record.baseVersions.every((version) => !known.has(version.path) || known.get(version.path) === version.fingerprint);
  const sameRows = record.rows.every((row) => {
    const original = state.originalTables[record.table][row.rowKey];
    return !original || (original.isComment === row.isComment && stableDeepEqual(original.data, row.data));
  });
  if ((hasCsvTableDraftChanges(state, record.table) || pending) && (!sameVersions || !sameRows)) {
    state.pendingExternalTableUpdates[record.table] = true;
    return false;
  }
  return true;
}
export function applyCsvTableIndexDraft(
  state: ModTableState,
  record: DeepReadonly<CsvTableIndex>,
  filtered = false,
  pending = false,
): CsvDraftResult {
  const table = record.table;
  if (!acceptsRows(state, record, pending)) return { changed: false, externalUpdateMarked: true };
  if (!filtered) {
    const known = new Map(state.baseVersions[table].map((version) => [version.path, version.fingerprint]));
    const changed =
      !stableDeepEqual(state.originalRowOrders[table], record.rowKeys) ||
      record.baseVersions.some((version) => known.has(version.path) && known.get(version.path) !== version.fingerprint);
    if (changed && (hasCsvTableDraftChanges(state, table) || pending)) {
      state.pendingExternalTableUpdates[table] = true;
      return { changed: false, externalUpdateMarked: true };
    }
    if (changed) {
      state.tables[table] = {};
      state.originalTables[table] = {};
      state.originalRowOrders[table] = [...record.rowKeys];
      state.rowOrders[table] = [...record.rowKeys];
    }
    delete state.queryRowKeys[table];
  } else state.queryRowKeys[table] = [...record.rowKeys];
  if (!stableDeepEqual(state.headers[table], record.header)) state.headers[table] = [...record.header];
  state.baseVersions[table] = cloneQuerySnapshot<ModTableState['baseVersions'][CsvTableKey]>(record.baseVersions);
  acceptRows(state, record);
  updateCounts(state, table);
  return { changed: true };
}
export function applyCsvTableRowsDraft(state: ModTableState, record: DeepReadonly<CsvTableRowsRead>, pending = false): CsvDraftResult {
  if (!acceptsRows(state, record, pending)) return { changed: false, externalUpdateMarked: true };
  const versions = new Map(state.baseVersions[record.table].map((version) => [version.path, version.fingerprint]));
  if (record.baseVersions.some((version) => versions.get(version.path) !== version.fingerprint)) {
    state.pendingExternalTableUpdates[record.table] = true;
    return { changed: false, externalUpdateMarked: true };
  }
  acceptRows(state, record);
  return { changed: true };
}
function acceptRows(state: ModTableState, record: DeepReadonly<CsvTableRowsRead>) {
  for (const entry of record.rows) {
    const original = state.originalTables[record.table][entry.rowKey];
    if (!original) state.originalTables[record.table][entry.rowKey] = cloneQuerySnapshot<CsvDraftRow>(entry);
    if (!state.tables[record.table][entry.rowKey] && state.dirty[record.table][entry.rowKey]?.action !== 'delete')
      state.tables[record.table][entry.rowKey] = cloneQuerySnapshot<CsvDraftRow>(entry);
  }
}
export function hasCsvTableDraftChanges(state: ModTableState, table: CsvTableKey): boolean {
  return Object.keys(state.dirty[table]).length > 0 || hasCsvRowOrderChanges(state, table);
}
export function hasCsvRowOrderChanges(state: ModTableState, table: CsvTableKey): boolean {
  return !stableDeepEqual(state.rowOrders[table], state.originalRowOrders[table]);
}
export function csvVisibleRowKeys(state: ModTableState, table: CsvTableKey) {
  return state.queryRowKeys[table] ?? state.rowOrders[table];
}
export function moveCsvRowDraft(state: ModTableState, tab: CsvTableKey, rowKey: string, nextIndex: number): CsvDraftResult {
  const order = state.rowOrders[tab],
    previousIndex = order.indexOf(rowKey);
  if (previousIndex < 0 || previousIndex === nextIndex) return { changed: false };
  order.splice(previousIndex, 1);
  order.splice(nextIndex, 0, rowKey);
  state.selectedRowKey = rowKey;
  return {
    changed: true,
    historyLabel: '移动 ' + tab + ' 行',
    historyOperation: { type: 'row-moved', tab, rowKey, previousIndex, nextIndex },
  };
}
export function markCsvTableExternalUpdateDraft(state: ModTableState, table: CsvTableKey): void {
  state.pendingExternalTableUpdates[table] = true;
}
export function clearCsvTableExternalUpdateDraft(state: ModTableState, table: CsvTableKey): void {
  state.pendingExternalTableUpdates[table] = false;
}
export function setCsvCellValueDraft(state: ModTableState, tab: CsvTableKey, rowKey: string, col: string, value: string): CsvDraftResult {
  const row = state.tables[tab][rowKey];
  if (!row) return { changed: false };
  const previousValue = cell(row.data[col]),
    previousIsComment = row.isComment;
  row.data[col] = value;
  if (col === state.headers[tab][0] && value !== previousValue) {
    const original = state.originalTables[tab][rowKey];
    row.isComment = original && value === cell(original.data[col]) ? original.isComment : value.startsWith('#');
  }
  refreshCellDirty(state, tab, row, col);
  return value === previousValue
    ? { changed: true }
    : {
        changed: true,
        historyLabel: '编辑 ' + tab + ' [' + col + ']',
        historyOperation: {
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
export function createCsvRowDraft(state: ModTableState, now: number): CsvDraftResult {
  const tab = state.currentTab,
    visible = csvVisibleRowKeys(state, tab);
  const selectedIndex = state.selectedRowKey === null ? -1 : state.rowOrders[tab].indexOf(state.selectedRowKey);
  const rowIndex = selectedIndex < 0 ? state.rowOrders[tab].length : selectedIndex + 1;
  const id = 'new_' + tab + '_' + now;
  const row: CsvDraftRow = {
    rowKey: createTableRowKey(tab, state.nextRowKey++),
    data: Object.fromEntries(state.headers[tab].map((col) => [col, ''])),
    isComment: false,
  };
  if ('id' in row.data) row.data.id = id;
  if ('name' in row.data) row.data.name = id;
  state.tables[tab][row.rowKey] = row;
  state.rowOrders[tab].splice(rowIndex, 0, row.rowKey);
  if (state.queryRowKeys[tab]) {
    const index = state.selectedRowKey ? visible.indexOf(state.selectedRowKey) : -1;
    visible.splice(index < 0 ? visible.length : index + 1, 0, row.rowKey);
  }
  state.selectedRowKey = row.rowKey;
  markRowDirty(state, tab, row);
  updateCounts(state, tab);
  return {
    changed: true,
    historyLabel: '新建 ' + tab + ' 行: ' + id,
    historyOperation: { type: 'row-created', tab, rowKey: row.rowKey, rowIndex, row: deepClone(row) },
  };
}
export function deleteSelectedCsvRowDraft(state: ModTableState): CsvDraftResult {
  const tab = state.currentTab,
    rowKey = state.selectedRowKey;
  if (!rowKey) return { changed: false };
  const row = state.tables[tab][rowKey],
    rowIndex = state.rowOrders[tab].indexOf(rowKey);
  if (!row || rowIndex < 0) return { changed: false };
  const result = {
    changed: true,
    historyLabel: '删除 ' + tab + ' 行: ' + (rowDisplayId(row.data) || '第 ' + (rowIndex + 1) + ' 行'),
    historyOperation: { type: 'row-deleted' as const, tab, rowKey, rowIndex, row: deepClone(row) },
  };
  removeRow(state, tab, rowKey);
  return result;
}
export function applyCsvDraftOperation(
  state: ModTableState | undefined,
  operation: CsvDraftOperation,
  direction: 'undo' | 'redo',
): boolean {
  if (!state) return false;
  const { tab, rowKey } = operation;
  if (operation.type === 'row-moved')
    return moveCsvRowDraft(state, tab, rowKey, direction === 'undo' ? operation.previousIndex : operation.nextIndex).changed;
  if (operation.type === 'cell-value-set') {
    const row = state.tables[tab][rowKey];
    if (!row) return false;
    row.data[operation.col] = direction === 'undo' ? operation.previousValue : operation.newValue;
    if (operation.col === state.headers[tab][0])
      row.isComment = direction === 'undo' ? operation.previousIsComment : operation.newIsComment;
    refreshCellDirty(state, tab, row, operation.col);
    return true;
  }
  if ((operation.type === 'row-created') === (direction === 'undo')) return removeRow(state, tab, rowKey);
  if (state.rowOrders[tab].includes(rowKey)) return true;
  const row = deepClone(operation.row);
  row.rowKey = rowKey;
  state.tables[tab][rowKey] = row;
  state.rowOrders[tab].splice(operation.rowIndex, 0, rowKey);
  if (state.queryRowKeys[tab]) state.queryRowKeys[tab].splice(operation.rowIndex, 0, rowKey);
  markRowDirty(state, tab, row);
  updateCounts(state, tab);
  return true;
}
function removeRow(state: ModTableState, tab: CsvTableKey, rowKey: string) {
  const index = state.rowOrders[tab].indexOf(rowKey);
  if (index < 0) return false;
  state.rowOrders[tab].splice(index, 1);
  const query = state.queryRowKeys[tab];
  if (query) {
    const index = query.indexOf(rowKey);
    if (index >= 0) query.splice(index, 1);
  }
  delete state.tables[tab][rowKey];
  if (state.originalRowOrders[tab].includes(rowKey)) state.dirty[tab][rowKey] = createCsvDeletedRow();
  else delete state.dirty[tab][rowKey];
  if (state.selectedRowKey === rowKey) state.selectedRowKey = null;
  if (state.editing?.table === tab && state.editing.rowKey === rowKey) state.editing = null;
  updateCounts(state, tab);
  return true;
}
export function discardCsvTableWindowForReloadDraft(state: ModTableState, tab: CsvTableKey): void {
  state.tables[tab] = deepClone(state.originalTables[tab]);
  state.rowOrders[tab] = [...state.originalRowOrders[tab]];
  state.dirty[tab] = {};
  state.pendingExternalTableUpdates[tab] = false;
  if (state.currentTab === tab) {
    state.editing = null;
    state.selectedRowKey = null;
  }
  updateCounts(state, tab);
}
export function markCsvTableSavedDraft(state: ModTableState, tab: CsvTableKey): void {
  state.originalTables[tab] = deepClone(state.tables[tab]);
  state.originalRowOrders[tab] = [...state.rowOrders[tab]];
  state.dirty[tab] = {};
  state.pendingExternalTableUpdates[tab] = false;
}
export function replaceCsvTableDraft(state: ModTableState, tab: CsvTableKey, rows: CsvDraftRow[]): void {
  state.tables[tab] = Object.fromEntries(rows.map((row) => [row.rowKey, deepClone(row)]));
  state.rowOrders[tab] = rows.map((row) => row.rowKey);
  delete state.queryRowKeys[tab];
  markCsvTableSavedDraft(state, tab);
  updateCounts(state, tab);
}
export function applySavedCsvRowKeyMapDraft(state: ModTableState, tab: CsvTableKey, keyMap: CsvRowKeyMapping[]): void {
  const mapped = new Map(keyMap.map((entry) => [entry.previousKey, entry.nextKey]));
  for (const rows of [state.tables[tab], state.originalTables[tab]]) {
    for (const { previousKey, nextKey } of keyMap) {
      const row = rows[previousKey];
      if (!row || previousKey === nextKey) continue;
      delete rows[previousKey];
      row.rowKey = nextKey;
      rows[nextKey] = row;
    }
  }
  for (const order of [state.rowOrders[tab], state.originalRowOrders[tab], state.queryRowKeys[tab]]) {
    if (order) for (let index = 0; index < order.length; index++) order[index] = mapped.get(order[index]!) ?? order[index]!;
  }
  for (const { previousKey, nextKey } of keyMap) {
    const dirty = state.dirty[tab][previousKey];
    if (dirty && previousKey !== nextKey) {
      delete state.dirty[tab][previousKey];
      state.dirty[tab][nextKey] = dirty;
    }
  }
  if (state.selectedRowKey) state.selectedRowKey = mapped.get(state.selectedRowKey) ?? state.selectedRowKey;
  if (state.editing?.table === tab) state.editing.rowKey = mapped.get(state.editing.rowKey) ?? state.editing.rowKey;
}
export function commitCsvTableSaveDraft(
  state: ModTableState,
  tab: CsvTableKey,
  patches: CsvRowPatch[],
  keyMap: CsvRowKeyMapping[],
  submittedOrder: CsvRowOrderEntry[] | null = null,
) {
  const savedOrder = [...(submittedOrder ?? state.originalRowOrders[tab])];
  const original = state.originalTables[tab];
  for (const patch of patches) {
    if (patch.action === 'delete') delete original[patch.rowKey];
    else original[patch.rowKey] = { rowKey: patch.rowKey, data: deepClone(patch.row), isComment: patch.isComment };
  }
  applySavedCsvRowKeyMapDraft(state, tab, keyMap);
  const mapped = new Map(keyMap.map((entry) => [entry.previousKey, entry.nextKey]));
  state.originalRowOrders[tab] = savedOrder.map((key) => mapped.get(key) ?? key);
  for (const patch of patches) {
    if (patch.action !== 'delete' || !state.tables[tab][patch.rowKey]) continue;
    const nextKey = createTableRowKey(tab, state.nextRowKey++);
    const mapping = { previousKey: patch.rowKey, nextKey, rowIndex: state.rowOrders[tab].indexOf(patch.rowKey) };
    keyMap.push(mapping);
    applySavedCsvRowKeyMapDraft(state, tab, [mapping]);
  }
  rebuildDirty(state, tab);
  state.pendingExternalTableUpdates[tab] = false;
  updateCounts(state, tab);
}
function updateCounts(state: ModTableState, tab: CsvTableKey) {
  state.totalRows[tab] = state.rowOrders[tab].length;
  state.filteredRows[tab] = csvVisibleRowKeys(state, tab).length;
}
function refreshCellDirty(state: ModTableState, tab: CsvTableKey, row: CsvDraftRow, col: string) {
  const original = state.originalTables[tab][row.rowKey],
    value = cell(row.data[col]);
  if (value !== cell(original?.data[col]) || (col === state.headers[tab][0] && row.isComment !== original?.isComment)) {
    ensureDirtyCells(state, tab, row.rowKey)[col] = value;
  } else {
    const cells = csvDirtyCells(state.dirty[tab][row.rowKey]);
    if (cells) delete cells[col];
    if (original && !hasCsvDirtyCells(state.dirty[tab][row.rowKey])) delete state.dirty[tab][row.rowKey];
  }
}
function ensureDirtyCells(state: ModTableState, tab: CsvTableKey, rowKey: string) {
  state.dirty[tab][rowKey] ??= createCsvDirtyCells();
  return csvDirtyCells(state.dirty[tab][rowKey])!;
}
function markRowDirty(state: ModTableState, tab: CsvTableKey, row: CsvDraftRow) {
  delete state.dirty[tab][row.rowKey];
  if (!state.originalTables[tab][row.rowKey]) state.dirty[tab][row.rowKey] = createCsvDirtyCells();
  for (const key of Object.keys(row.data)) refreshCellDirty(state, tab, row, key);
}
function rebuildDirty(state: ModTableState, tab: CsvTableKey) {
  state.dirty[tab] = {};
  const current = new Set(state.rowOrders[tab]);
  for (const row of Object.values(state.tables[tab])) markRowDirty(state, tab, row);
  for (const rowKey of state.originalRowOrders[tab]) if (!current.has(rowKey)) state.dirty[tab][rowKey] = createCsvDeletedRow();
}
