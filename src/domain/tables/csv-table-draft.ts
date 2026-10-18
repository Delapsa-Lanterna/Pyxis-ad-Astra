import type {
  CsvDraftOperation,
  CsvRowKeyMapping,
  CsvRowPatch,
  CsvTableWindow,
  ModTableState,
  CsvDraftRow,
  RowData,
  CsvTableKey,
  CsvRowOrderEntry,
} from '@/shared/types';
import { cell, deepClone, rowDisplayId } from '@/shared/lib/starsector';
import { createCsvDeletedRow, createCsvDirtyCells, csvDirtyCells, hasCsvDirtyCells } from '@/domain/tables/csv-dirty';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';
import { createTableRowKey } from '@/domain/tables/table-row-key';
import type { DeepReadonly } from '@/shared/types';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

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

/// Row identity of a row-created/row-deleted draft result, for log records.
export function csvRowTargetOf(result: CsvDraftResult): CsvRowTarget | null {
  const operation = result.historyOperation;
  if (!operation || (operation.type !== 'row-created' && operation.type !== 'row-deleted')) return null;
  return { rowKey: operation.rowKey, rowIndex: operation.rowIndex };
}

export function applyCsvTableWindowDraft(
  state: ModTableState,
  record: DeepReadonly<CsvTableWindow>,
  hasPendingInput = false,
): CsvDraftResult {
  const table = record.table;
  const expectedPaths = new Set(state.baseVersions[table].map((version) => version.path));
  const sameVersions = stableDeepEqual(
    state.baseVersions[table],
    record.baseVersions.filter((version) => expectedPaths.has(version.path)),
  );
  const order = state.rowOrders[table];
  if (order) {
    const originals = state.originalTables[table];
    if (
      !sameVersions ||
      record.rows.some((entry) => {
        const original = originals[entry.sourceRowIndex];
        return (
          original &&
          (original.rowKey !== entry.rowKey || original.isComment !== entry.isComment || !stableDeepEqual(original.data, entry.data))
        );
      })
    ) {
      state.pendingExternalTableUpdates[table] = true;
      return { changed: false, externalUpdateMarked: true };
    }
    const positions = new Map(order.map((token, index) => [token, index]));
    for (const entry of record.rows) {
      const row: CsvDraftRow = { ...entry, data: deepClone(entry.data) as RowData, insertAt: null };
      originals[entry.sourceRowIndex] = row;
      const index = positions.get(entry.sourceRowIndex);
      if (index !== undefined && !state.tables[table][index]) state.tables[table][index] = deepClone(row);
    }
    return { changed: true };
  }
  if (hasCsvTableDraftChanges(state, table) || hasPendingInput) {
    const originalRows = new Map(state.originalTables[table].filter(isLoadedCsvTableRow).map((row) => [row.rowKey, row]));
    const sameBaseline =
      sameVersions &&
      record.rows.every((entry) => {
        const original = originalRows.get(entry.rowKey);
        return original !== undefined && original.isComment === entry.isComment && stableDeepEqual(original.data, entry.data);
      });
    if (sameBaseline) {
      for (const entry of record.rows) {
        const original = originalRows.get(entry.rowKey)!;
        original.sourceRowIndex = entry.sourceRowIndex;
        const current = findLoadedRow(state, table, entry.rowKey);
        if (current) {
          current.sourceRowIndex = entry.sourceRowIndex;
        }
      }
      return { changed: true };
    }
    state.pendingExternalTableUpdates[table] = true;
    return { changed: false, externalUpdateMarked: true };
  }
  state.headers[table] = [...record.header];
  state.baseVersions[table] = [...record.baseVersions];
  state.totalRows[table] = record.totalRows;
  state.filteredRows[table] = record.filteredRows;
  const rows: CsvDraftRow[] = record.rows.map((entry) => ({
    rowKey: entry.rowKey,
    data: deepClone(entry.data) as RowData,
    isComment: entry.isComment,
    sourceRowIndex: entry.sourceRowIndex,
    insertAt: null,
  }));
  state.tables[table] = mergeWindowRows(state.tables[table], rows, record.start, record.filteredRows);
  state.originalTables[table] = mergeWindowRows(state.originalTables[table], deepClone(rows), record.start, record.filteredRows);
  return { changed: true };
}

export function hasCsvTableDraftChanges(state: ModTableState, table: CsvTableKey): boolean {
  return Object.keys(state.dirty[table]).length > 0 || hasCsvRowOrderChanges(state, table);
}

export function hasCsvRowOrderChanges(state: ModTableState, table: CsvTableKey): boolean {
  const order = state.rowOrders[table];
  if (!order) return false;
  const insertions = new Map(
    state.tables[table].flatMap((row) => (row?.rowKey.includes(':new:') ? [[row.rowKey, row.insertAt ?? Infinity] as const] : [])),
  );
  let previous = -1;
  return order.some((token) => {
    const rank = typeof token === 'number' ? token + 0.5 : insertions.get(token)!;
    const changed = rank < previous;
    previous = rank;
    return changed;
  });
}

export function csvDraftSourceRanges(state: ModTableState, table: CsvTableKey, start: number, count: number) {
  const order = state.rowOrders[table];
  if (!order) return [{ start, count }];
  const sources = order
    .slice(start, start + count)
    .flatMap((token, offset) => (typeof token === 'number' && !state.tables[table][start + offset] ? [token] : []))
    .sort((a, b) => a - b);
  const ranges: Array<{ start: number; count: number }> = [];
  for (const source of sources) {
    const last = ranges.at(-1);
    if (last && last.start + last.count === source) last.count++;
    else ranges.push({ start: source, count: 1 });
  }
  return ranges;
}

export function prepareCsvRowOrder(state: ModTableState, tab: CsvTableKey): void {
  if (!state.rowOrders[tab]) {
    const removed = new Set(
      state.originalTables[tab].flatMap((row) => (row && state.dirty[tab][row.rowKey]?.action === 'delete' ? [row.sourceRowIndex] : [])),
    );
    const sources = Array.from({ length: state.originalTables[tab].length }, (_, index) => index).filter((index) => !removed.has(index));
    let source = 0;
    state.rowOrders[tab] = state.tables[tab].map((row) => (row?.rowKey.includes(':new:') ? row.rowKey : sources[source++]!));
  }
}

export function moveCsvRowDraft(state: ModTableState, tab: CsvTableKey, rowKey: string, nextIndex: number): CsvDraftResult {
  const previousIndex = findLoadedRowIndex(state, tab, rowKey);
  if (previousIndex < 0 || previousIndex === nextIndex) return { changed: false };
  prepareCsvRowOrder(state, tab);
  const [row] = state.tables[tab].splice(previousIndex, 1);
  state.tables[tab].splice(nextIndex, 0, row!);
  const [token] = state.rowOrders[tab]!.splice(previousIndex, 1);
  state.rowOrders[tab]!.splice(nextIndex, 0, token!);
  state.selectedRowKey = rowKey;
  return { changed: true, historyLabel: `移动 ${tab} 行`, historyOperation: { type: 'row-moved', tab, rowKey, previousIndex, nextIndex } };
}

export function markCsvTableExternalUpdateDraft(state: ModTableState, table: CsvTableKey): void {
  state.pendingExternalTableUpdates[table] = true;
}

export function clearCsvTableExternalUpdateDraft(state: ModTableState, table: CsvTableKey): void {
  state.pendingExternalTableUpdates[table] = false;
}

export function setCsvCellValueDraft(state: ModTableState, tab: CsvTableKey, rowKey: string, col: string, value: string): CsvDraftResult {
  const row = findLoadedRow(state, tab, rowKey);
  if (!row) return { changed: false };
  const previousValue = cell(row.data[col]);
  const previousIsComment = row.isComment;
  row.data[col] = value;
  if (col === state.headers[tab][0] && value !== previousValue) {
    const original = findOriginalRow(state, tab, rowKey);
    row.isComment = original && value === cell(original.data[col]) ? original.isComment : value.startsWith('#');
  }
  refreshCsvCellDirty(state, tab, row, col, value);
  if (value === previousValue) return { changed: true };
  return {
    changed: true,
    historyLabel: `编辑 ${tab} [${col}]`,
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
  const tab = state.currentTab;
  const selectedIndex = state.selectedRowKey === null ? -1 : findLoadedRowIndex(state, tab, state.selectedRowKey);
  const selected = state.tables[tab][selectedIndex];
  const rowIndex = selectedIndex < 0 ? state.tables[tab].length : selectedIndex + 1;
  const id = `new_${tab}_${now}`;
  const row: CsvDraftRow = {
    rowKey: createTableRowKey(tab, state.nextRowKey++),
    data: Object.fromEntries(state.headers[tab].map((col) => [col, ''])),
    isComment: false,
    sourceRowIndex: null,
    insertAt: selected ? (selected.insertAt ?? (selected.sourceRowIndex === null ? null : selected.sourceRowIndex + 1)) : null,
  };
  if ('id' in row.data) row.data.id = id;
  if ('name' in row.data) row.data.name = id;

  state.tables[tab].splice(rowIndex, 0, row);
  state.rowOrders[tab]?.splice(rowIndex, 0, row.rowKey);
  adjustCsvTableRowCounts(state, tab, 1);
  const rowKey = row.rowKey;
  state.selectedRowKey = rowKey;
  markCsvRowDirty(state, tab, rowKey, row);
  return {
    changed: true,
    historyLabel: `新建 ${tab} 行: ${id}`,
    historyOperation: { type: 'row-created', tab, rowKey, rowIndex, row: deepClone(row) },
  };
}

export function deleteSelectedCsvRowDraft(state: ModTableState): CsvDraftResult {
  const tab = state.currentTab;
  const rowKey = state.selectedRowKey;
  if (!rowKey) return { changed: false };
  const rowIndex = findLoadedRowIndex(state, tab, rowKey);
  if (rowIndex < 0) {
    state.selectedRowKey = null;
    return { changed: false };
  }
  const row = state.tables[tab][rowIndex];
  if (!isLoadedCsvTableRow(row)) return { changed: false };
  const id = rowDisplayId(row.data) || `第 ${rowIndex + 1} 行`;
  state.tables[tab] = state.tables[tab].filter((candidate) => candidate !== row);
  state.rowOrders[tab]?.splice(rowIndex, 1);
  adjustCsvTableRowCounts(state, tab, -1);
  markCsvRowDeleted(state, tab, rowKey);
  state.selectedRowKey = null;
  return {
    changed: true,
    historyLabel: `删除 ${tab} 行: ${id}`,
    historyOperation: { type: 'row-deleted', tab, rowKey, rowIndex, row: deepClone(row) },
  };
}

export function applyCsvDraftOperation(
  state: ModTableState | undefined,
  operation: CsvDraftOperation,
  direction: 'undo' | 'redo',
): boolean {
  if (!state) return false;
  if (operation.type === 'row-moved') {
    return moveCsvRowDraft(state, operation.tab, operation.rowKey, direction === 'undo' ? operation.previousIndex : operation.nextIndex)
      .changed;
  }
  if (operation.type === 'cell-value-set') {
    return setCsvCellValueForReplay(
      state,
      operation.tab,
      operation.rowKey,
      operation.col,
      direction === 'undo' ? operation.previousValue : operation.newValue,
      direction === 'undo' ? operation.previousIsComment : operation.newIsComment,
    );
  }
  if (operation.type === 'row-created') {
    return direction === 'undo'
      ? removeCsvRowForReplay(state, operation.tab, operation.rowKey)
      : insertCsvRowForReplay(state, operation.tab, operation.rowIndex, operation.rowKey, operation.row);
  }
  return direction === 'undo'
    ? insertCsvRowForReplay(state, operation.tab, operation.rowIndex, operation.rowKey, operation.row)
    : removeCsvRowForReplay(state, operation.tab, operation.rowKey);
}

export function discardCsvTableWindowDraft(state: ModTableState, tab: CsvTableKey): void {
  delete state.rowOrders[tab];
  state.tables[tab] = [];
  state.originalTables[tab] = [];
  state.dirty[tab] = {};
  if (state.currentTab === tab) {
    state.selectedRowKey = null;
    state.editing = null;
  }
}

export function discardCsvTableWindowForReloadDraft(state: ModTableState, tab: CsvTableKey): void {
  discardCsvTableWindowDraft(state, tab);
  state.pendingExternalTableUpdates[tab] = false;
}

export function markCsvTableSavedDraft(state: ModTableState, tab: CsvTableKey): void {
  delete state.rowOrders[tab];
  state.originalTables[tab] = deepClone(state.tables[tab]);
  state.dirty[tab] = {};
  state.pendingExternalTableUpdates[tab] = false;
}

export function commitCsvTableSaveDraft(
  state: ModTableState,
  tab: CsvTableKey,
  patches: CsvRowPatch[],
  keyMap: CsvRowKeyMapping[],
  submittedOrder: CsvRowOrderEntry[] | null = null,
) {
  if (submittedOrder) return commitCsvOrderSave(state, tab, patches, keyMap, submittedOrder);
  const removedPositions = patches
    .filter((patch) => patch.action === 'delete')
    .flatMap((patch) => {
      const row = findOriginalRow(state, tab, patch.rowKey);
      return typeof row?.sourceRowIndex === 'number' ? [row.sourceRowIndex] : [];
    });
  const insertions = [...keyMap].sort((left, right) => left.rowIndex - right.rowIndex);
  applySavedCsvRowKeyMapDraft(state, tab, keyMap);
  const rowOrder = new Map(state.tables[tab].flatMap((row, index) => (row ? [[row.rowKey, index] as const] : [])));
  function rebaseRow(row: CsvDraftRow, rowIndex = rowOrder.get(row.rowKey) ?? Infinity) {
    if (keyMap.some((mapping) => mapping.nextKey === row.rowKey)) return;
    const boundary = row.insertAt ?? row.sourceRowIndex;
    if (boundary === null) return;
    let position = boundary - removedPositions.filter((removed) => removed < boundary).length;
    for (const insertion of insertions) {
      if (position > insertion.rowIndex || (position === insertion.rowIndex && (rowOrder.get(insertion.nextKey) ?? -1) < rowIndex))
        position++;
    }
    if (row.insertAt !== null) row.insertAt = position;
    else row.sourceRowIndex = position;
  }
  const original = state.originalTables[tab];
  const mapped = new Map(keyMap.map((item) => [item.previousKey, item.nextKey]));
  for (const patch of patches) {
    const rowKey = mapped.get(patch.rowKey) ?? patch.rowKey;
    const index = original.findIndex((candidate) => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey);
    if (patch.action === 'delete') {
      if (index >= 0) original.splice(index, 1);
      const restored = findLoadedRow(state, tab, rowKey);
      if (restored) {
        const previousKey = rowKey;
        const nextKey = createTableRowKey(tab, state.nextRowKey++);
        rebaseRow(restored);
        const rowIndex = restored.sourceRowIndex!;
        restored.insertAt = rowIndex;
        const mapping = { previousKey, nextKey, rowIndex };
        keyMap.push(mapping);
        applySavedCsvRowKeyMapDraft(state, tab, [mapping]);
      }
      continue;
    }
    const sourceIndex =
      keyMap.find((mapping) => mapping.nextKey === rowKey)?.rowIndex ?? (index >= 0 ? original[index]?.sourceRowIndex : undefined);
    const savedRow: CsvDraftRow = {
      data: deepClone(patch.row),
      isComment: patch.isComment,
      rowKey,
      sourceRowIndex: sourceIndex ?? null,
      insertAt: null,
    };
    if (index >= 0) original[index] = savedRow;
    else original.push(savedRow);
  }
  for (const row of [...state.tables[tab], ...state.originalTables[tab]]) {
    if (row) rebaseRow(row);
  }
  rebuildCsvDirty(state, tab);
  state.pendingExternalTableUpdates[tab] = false;
  return rebaseRow;
}

export function replaceCsvTableDraft(state: ModTableState, tab: CsvTableKey, rows: CsvDraftRow[]): void {
  delete state.rowOrders[tab];
  state.tables[tab] = deepClone(rows);
  state.originalTables[tab] = deepClone(state.tables[tab]);
  state.dirty[tab] = {};
  state.pendingExternalTableUpdates[tab] = false;
}

export function applySavedCsvRowKeyMapDraft(state: ModTableState, tab: CsvTableKey, keyMap: CsvRowKeyMapping[]): void {
  if (keyMap.length === 0) return;
  const mapped = new Map(keyMap.map((item) => [item.previousKey, item.nextKey]));
  for (const row of state.tables[tab]) applySavedRowKey(row, mapped);
  for (const row of state.originalTables[tab]) applySavedRowKey(row, mapped);
  for (const row of state.tables[tab]) {
    if (!row) continue;
    const mapping = keyMap.find((mapping) => mapping.nextKey === row.rowKey);
    if (mapping && !mapping.nextKey.includes(':new:')) {
      row.sourceRowIndex = mapping.rowIndex;
      row.insertAt = null;
    }
  }
  if (state.selectedRowKey) {
    state.selectedRowKey = mapped.get(state.selectedRowKey) ?? state.selectedRowKey;
  }
  if (state.editing?.table === tab) {
    state.editing.rowKey = mapped.get(state.editing.rowKey) ?? state.editing.rowKey;
  }
}

function commitCsvOrderSave(
  state: ModTableState,
  tab: CsvTableKey,
  patches: CsvRowPatch[],
  keyMap: CsvRowKeyMapping[],
  submitted: CsvRowOrderEntry[],
) {
  const positions = new Map(submitted.map((token, index) => [token, index]));
  const savedKeys = new Map(keyMap.map((mapping) => [mapping.nextKey, mapping.rowIndex]));
  const mappedKeys = new Map(keyMap.map((mapping) => [mapping.previousKey, mapping.nextKey]));
  const updates = new Map(patches.filter((patch) => patch.action === 'upsert').map((patch) => [patch.rowKey, patch]));
  const originalBySource = new Map(state.originalTables[tab].flatMap((row) => (row ? [[row.sourceRowIndex!, row] as const] : [])));
  const baseline = submitted.map((token, index): CsvDraftRow | null => {
    const original = typeof token === 'number' ? originalBySource.get(token) : undefined;
    const patch = updates.get(typeof token === 'string' ? token : (original?.rowKey ?? ''));
    if (!original && !patch) return null;
    const previousKey = patch?.rowKey ?? original!.rowKey;
    const rowKey = mappedKeys.get(previousKey) ?? previousKey;
    savedKeys.set(rowKey, index);
    return {
      rowKey,
      data: deepClone(patch?.row ?? original!.data),
      isComment: patch?.isComment ?? original!.isComment,
      sourceRowIndex: index,
      insertAt: null,
    };
  });
  const current = state.rowOrders[tab]!;
  const removedKeys = new Map<string, { rowKey: string; boundary: number }>();
  const boundaries = new Array<number>(current.length);
  let boundary = submitted.length;
  for (let index = current.length - 1; index >= 0; index--) {
    boundaries[index] = boundary;
    boundary = positions.get(current[index]!) ?? boundary;
  }
  state.rowOrders[tab] = current.map((token, index) => {
    const position = positions.get(token),
      row = state.tables[tab][index];
    if (position !== undefined) {
      if (row) {
        row.sourceRowIndex = position;
        row.insertAt = null;
      }
      return position;
    }
    if (typeof token === 'number') {
      const previousKey = row!.rowKey,
        rowKey = createTableRowKey(tab, state.nextRowKey++);
      removedKeys.set(previousKey, { rowKey, boundary: boundaries[index]! });
      removedKeys.set(rowKey, { rowKey, boundary: boundaries[index]! });
      keyMap.push({ previousKey, nextKey: rowKey, rowIndex: boundaries[index]! });
      row!.rowKey = rowKey;
      row!.sourceRowIndex = null;
      row!.insertAt = boundaries[index]!;
      return rowKey;
    }
    row!.insertAt = boundaries[index]!;
    return token;
  });
  function rebaseRow(row: CsvDraftRow, rowIndex: number) {
    const restored = removedKeys.get(row.rowKey);
    const saved = savedKeys.get(row.rowKey);
    const position = saved ?? (row.sourceRowIndex === null ? undefined : positions.get(row.sourceRowIndex));
    if (restored) {
      row.rowKey = restored.rowKey;
      row.sourceRowIndex = null;
      row.insertAt = restored.boundary;
    } else if (position !== undefined) {
      row.sourceRowIndex = position;
      row.insertAt = null;
    } else row.insertAt = positions.get(current[rowIndex]!) ?? boundaries[rowIndex] ?? submitted.length;
  }
  applySavedCsvRowKeyMapDraft(state, tab, keyMap);
  state.originalTables[tab] = baseline;
  rebuildCsvDirty(state, tab);
  state.pendingExternalTableUpdates[tab] = false;
  return rebaseRow;
}

function setCsvCellValueForReplay(
  state: ModTableState,
  tab: CsvTableKey,
  rowKey: string,
  col: string,
  value: string,
  isComment: boolean,
): boolean {
  const row = findLoadedRow(state, tab, rowKey);
  if (!row) return false;
  row.data[col] = value;
  if (col === state.headers[tab][0]) row.isComment = isComment;
  refreshCsvCellDirty(state, tab, row, col, value);
  return true;
}

function insertCsvRowForReplay(state: ModTableState, tab: CsvTableKey, rowIndex: number, rowKey: string, row: CsvDraftRow): boolean {
  if (state.tables[tab].some((candidate) => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey)) return true;
  const next = deepClone(row);
  next.rowKey = rowKey;
  state.tables[tab].splice(Math.max(0, Math.min(rowIndex, state.tables[tab].length)), 0, next);
  state.rowOrders[tab]?.splice(rowIndex, 0, next.rowKey.includes(':new:') ? next.rowKey : next.sourceRowIndex!);
  adjustCsvTableRowCounts(state, tab, 1);
  markCsvRowDirty(state, tab, rowKey, next);
  return true;
}

function removeCsvRowForReplay(state: ModTableState, tab: CsvTableKey, rowKey: string): boolean {
  const index = findLoadedRowIndex(state, tab, rowKey);
  if (index < 0) return false;
  state.tables[tab].splice(index, 1);
  state.rowOrders[tab]?.splice(index, 1);
  adjustCsvTableRowCounts(state, tab, -1);
  markCsvRowDeleted(state, tab, rowKey);
  if (state.selectedRowKey === rowKey) state.selectedRowKey = null;
  if (state.editing?.table === tab && state.editing.rowKey === rowKey) state.editing = null;
  return true;
}

function adjustCsvTableRowCounts(state: ModTableState, tab: CsvTableKey, delta: number): void {
  state.totalRows[tab] = Math.max(0, state.totalRows[tab] + delta);
  state.filteredRows[tab] = Math.max(0, state.filteredRows[tab] + delta);
}

function refreshCsvCellDirty(state: ModTableState, tab: CsvTableKey, row: CsvDraftRow, col: string, value: string): void {
  const rowKey = row.rowKey;
  const original = findOriginalRow(state, tab, rowKey);
  const originalValue = cell(original?.data[col]);
  if (value !== originalValue || (col === state.headers[tab][0] && row.isComment !== original?.isComment)) {
    ensureCsvDirtyCells(state, tab, rowKey)[col] = value;
    return;
  }
  const cells = csvDirtyCells(state.dirty[tab][rowKey]);
  if (!cells) return;
  delete cells[col];
  if (!hasCsvDirtyCells(state.dirty[tab][rowKey])) delete state.dirty[tab][rowKey];
}

function rebuildCsvDirty(state: ModTableState, tab: CsvTableKey): void {
  state.dirty[tab] = {};
  const dirty = state.dirty[tab];
  const originalByKey = new Map(state.originalTables[tab].flatMap((row) => (isLoadedCsvTableRow(row) ? [[row.rowKey, row] as const] : [])));
  const currentKeys = new Set<string>();
  for (const row of state.tables[tab]) {
    if (!isLoadedCsvTableRow(row)) continue;
    const rowKey = row.rowKey;
    currentKeys.add(rowKey);
    const original = originalByKey.get(rowKey);
    for (const [key, value] of Object.entries(row.data)) {
      if (
        !original ||
        cell(value) !== cell(original.data[key]) ||
        (key === state.headers[tab][0] && row.isComment !== original.isComment)
      ) {
        ensureCsvDirtyCells(state, tab, rowKey)[key] = cell(value);
      }
    }
    if (!original && !dirty[rowKey]) dirty[rowKey] = createCsvDirtyCells();
  }
  for (const rowKey of originalByKey.keys()) {
    if (!currentKeys.has(rowKey)) dirty[rowKey] = createCsvDeletedRow();
  }
}

function markCsvRowDirty(state: ModTableState, tab: CsvTableKey, rowKey: string, row: CsvDraftRow): void {
  const original = findOriginalRow(state, tab, rowKey);
  delete state.dirty[tab][rowKey];
  if (!original) {
    state.dirty[tab][rowKey] = createCsvDirtyCells();
    const cells = csvDirtyCells(state.dirty[tab][rowKey]);
    if (!cells) return;
    for (const [key, value] of Object.entries(row.data)) {
      cells[key] = cell(value);
    }
    return;
  }
  for (const [key, value] of Object.entries(row.data)) {
    const next = cell(value);
    const prev = cell(original.data[key]);
    if (next !== prev || (key === state.headers[tab][0] && row.isComment !== original.isComment))
      ensureCsvDirtyCells(state, tab, rowKey)[key] = next;
  }
}

function markCsvRowDeleted(state: ModTableState, tab: CsvTableKey, rowKey: string): void {
  const originalExists = Boolean(findOriginalRow(state, tab, rowKey));
  if (originalExists) state.dirty[tab][rowKey] = createCsvDeletedRow();
  else delete state.dirty[tab][rowKey];
}

function ensureCsvDirtyCells(state: ModTableState, tab: CsvTableKey, rowKey: string): Record<string, string> {
  const existingCells = csvDirtyCells(state.dirty[tab][rowKey]);
  if (existingCells) return existingCells;
  state.dirty[tab][rowKey] = createCsvDirtyCells();
  return csvDirtyCells(state.dirty[tab][rowKey]) ?? {};
}

function findLoadedRow(state: ModTableState, tab: CsvTableKey, rowKey: string): CsvDraftRow | null {
  return (
    state.tables[tab].find((candidate): candidate is CsvDraftRow => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey) ?? null
  );
}

function findOriginalRow(state: ModTableState, tab: CsvTableKey, rowKey: string): CsvDraftRow | null {
  return (
    state.originalTables[tab].find(
      (candidate): candidate is CsvDraftRow => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey,
    ) ?? null
  );
}

function findLoadedRowIndex(state: ModTableState, tab: CsvTableKey, rowKey: string): number {
  return state.tables[tab].findIndex((candidate) => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey);
}

function mergeWindowRows(
  currentRows: Array<CsvDraftRow | null>,
  windowRows: CsvDraftRow[],
  start: number,
  rowCount: number,
): Array<CsvDraftRow | null> {
  const nextRows = Array.from(
    { length: Math.max(currentRows.length, start + windowRows.length, rowCount) },
    (_, index) => currentRows[index] ?? null,
  );
  for (let index = 0; index < windowRows.length; index += 1) {
    const row = windowRows[index];
    if (row === undefined) continue;
    nextRows[start + index] = row;
  }
  return nextRows;
}

function applySavedRowKey(row: CsvDraftRow | null, mapped: Map<string, string>): void {
  if (!isLoadedCsvTableRow(row)) return;
  const rowKey = row.rowKey;
  const nextKey = mapped.get(rowKey);
  if (nextKey) row.rowKey = nextKey;
}
