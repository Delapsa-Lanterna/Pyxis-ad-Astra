import { defineStore } from 'pinia';
import { computed, reactive, ref, shallowReactive } from 'vue';
import { createFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import type { CsvCellTarget, CsvTableTarget } from '@/shared/types';
import { normalizeFsPath } from '@/shared/lib/paths';
import {
  TABLE_KEYS,
  type CsvRowKeyMapping,
  type CsvTableRows,
  type CsvTableIndex,
  type CsvTableRowsRead,
  type ModTableState,
  type ProjectManifest,
  type CsvDraftRow,
  type CsvTableKey,
} from '@/shared/types';
import { csvColumnsForTable } from '@/domain/tables/csv-column-schema';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { csvDirtyCells } from '@/domain/tables/csv-dirty';
import { DEFAULT_CSV_SEARCH_FIELD } from '@/domain/tables/csv-search';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import {
  applyCsvTableIndexDraft,
  applyCsvTableRowsDraft,
  csvVisibleRowKeys,
  applySavedCsvRowKeyMapDraft,
  clearCsvTableExternalUpdateDraft,
  createCsvRowDraft,
  deleteSelectedCsvRowDraft,
  discardCsvTableWindowForReloadDraft,
  hasCsvTableDraftChanges,
  markCsvTableExternalUpdateDraft,
  markCsvTableSavedDraft,
  replaceCsvTableDraft,
  setCsvCellValueDraft,
  csvRowTargetOf,
  type CsvDraftResult,
  type CsvRowTarget,
  moveCsvRowDraft,
  hasCsvRowOrderChanges,
} from '@/domain/tables/csv-table-draft';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';

function emptyDirtyState(): ModTableState['dirty'] {
  return emptyTableRecord(() => ({}));
}

function emptyExternalUpdateState(): Record<CsvTableKey, boolean> {
  return emptyTableRecord(() => false);
}

function emptyTablesRecord(): ModTableState['tables'] {
  return emptyTableRecord(() => ({}));
}

function emptyHeadersRecord(): Record<CsvTableKey, string[]> {
  return emptyTableRecord(() => []);
}

function emptyCountRecord(): Record<CsvTableKey, number> {
  return emptyTableRecord(() => 0);
}

function emptyTableRecord<T>(createValue: () => T): Record<CsvTableKey, T> {
  return Object.fromEntries(TABLE_KEYS.map((key) => [key, createValue()])) as Record<CsvTableKey, T>;
}

function createModTableState(): ModTableState {
  return {
    rowOrders: emptyTableRecord(() => []),
    originalRowOrders: emptyTableRecord(() => []),
    queryRowKeys: {},
    baseVersions: emptyTableRecord(() => []),
    tables: emptyTablesRecord(),
    originalTables: emptyTablesRecord(),
    headers: emptyHeadersRecord(),
    totalRows: emptyCountRecord(),
    filteredRows: emptyCountRecord(),
    dirty: emptyDirtyState(),
    pendingExternalTableUpdates: emptyExternalUpdateState(),
    currentTab: 'ships',
    searchField: DEFAULT_CSV_SEARCH_FIELD,
    searchText: '',
    selectedRowKey: null,
    editing: null,
    nextRowKey: 0,
  };
}

function applyManifestSummaries(state: ModTableState, manifest: ProjectManifest) {
  for (const key of TABLE_KEYS) {
    const summary = manifest.tableSummaries[key];
    state.headers[key] = summary.header;
    if (summary.totalRows !== null) {
      state.totalRows[key] = summary.totalRows;
      state.filteredRows[key] = summary.totalRows;
    }
  }
}

export const useTablesStore = defineStore('tables', () => {
  const csvEditHistory = useTablesEditHistoryStore();
  const workspace = useWorkspaceStore();
  const stateMap = reactive<Map<string, ModTableState>>(new Map());
  const inputMap = shallowReactive(new Map<string, Map<CsvTableKey, FieldInputs>>());
  const readGenerations = new WeakMap<ModTableState, Map<CsvTableKey, number>>();
  const saving = ref(false);
  const identityLocks = shallowReactive(new Map<string, { target: CsvTableTarget; owner: string }>());
  const lockKey = (root: string, table: CsvTableKey) => JSON.stringify([normalizeFsPath(root), table]);
  const currentTableLocked = computed(() => (activeModRoot.value ? isTableLocked(activeModRoot.value, currentTab.value) : false));

  function isTableLocked(root: string, table: CsvTableKey) {
    return identityLocks.has(lockKey(root, table));
  }
  function lockTable(target: CsvTableTarget, owner: string) {
    identityLocks.set(lockKey(target.modRoot, target.table), { target, owner });
  }
  function releaseTableLock(owner: string) {
    for (const [key, lock] of identityLocks) {
      if (lock.owner === owner) identityLocks.delete(key);
    }
  }
  // Active mod identity is owned by the workspace store; tables projects it
  // onto its per-Mod table state instead of keeping its own copy in sync.
  const activeModRoot = computed(() => workspace.activeModRoot);

  function getActiveState(): ModTableState | undefined {
    return activeModRoot.value ? stateMap.get(activeModRoot.value) : undefined;
  }

  const tables = computed(() => getActiveState()?.tables ?? emptyTablesRecord());
  const currentTab = computed(() => getActiveState()?.currentTab ?? 'ships');
  const searchField = computed(() => getActiveState()?.searchField ?? DEFAULT_CSV_SEARCH_FIELD);
  const currentHeader = computed(() => getActiveState()?.headers[currentTab.value] ?? []);
  const searchText = computed(() => getActiveState()?.searchText ?? '');
  const selectedRowKey = computed(() => getActiveState()?.selectedRowKey ?? null);
  const editing = computed(() => getActiveState()?.editing ?? null);
  const dirty = computed(() => getActiveState()?.dirty ?? emptyDirtyState());

  const rows = computed(() => rowsFor(currentTab.value));
  const visibleColumns = computed(() => {
    const headerColumns = csvColumnsForTable(currentTab.value, currentHeader.value);
    if (headerColumns.length > 0) return headerColumns;
    const seen = new Set<string>();
    const inferred: string[] = [];
    for (const row of rows.value.filter(isLoadedCsvTableRow).slice(0, 50)) {
      for (const key of Object.keys(row.data)) {
        if (!seen.has(key)) {
          seen.add(key);
          inferred.push(key);
        }
      }
    }
    return csvColumnsForTable(currentTab.value, inferred);
  });
  const filteredRows = computed(() => rows.value);
  const rowKeys = computed(() => {
    const state = getActiveState();
    return state ? csvVisibleRowKeys(state, currentTab.value) : [];
  });
  const rowsByKey = computed(() => getActiveState()?.tables[currentTab.value] ?? {});
  const filteredRowCount = computed(() => getActiveState()?.filteredRows[currentTab.value] ?? 0);
  const hasCurrentTableFilter = computed(
    () => Boolean(searchText.value.trim()) || filteredRowCount.value !== (getActiveState()?.totalRows[currentTab.value] ?? 0),
  );
  const selectedRowRecord = computed(() =>
    selectedRowKey.value ? getActiveState()?.tables[currentTab.value][selectedRowKey.value] : undefined,
  );
  const selectedRow = computed(() => selectedRowRecord.value?.data);
  const tableInfo = computed(() => {
    const state = getActiveState();
    if (!state) return '显示 0 / 0 行';
    return `显示 ${state.filteredRows[state.currentTab]} / ${state.totalRows[state.currentTab]} 行`;
  });
  const hasAnyTableDirtyChanges = computed(() => {
    const state = getActiveState();
    return state ? TABLE_KEYS.some((key) => hasCsvTableDraftChanges(state, key)) : false;
  });
  const hasCurrentRowOrderChanges = computed(() => {
    const state = getActiveState();
    return state ? hasCsvRowOrderChanges(state, currentTab.value) : false;
  });
  const hasCurrentTableChanges = computed(() => {
    const state = getActiveState();
    if (!state) return false;
    return hasTableDirtyChanges(state.currentTab);
  });
  const hasCurrentTableExternalUpdate = computed(() => {
    const state = getActiveState();
    return state ? state.pendingExternalTableUpdates[state.currentTab] : false;
  });
  const canUndoCurrentTableEdit = computed(() =>
    activeModRoot.value ? csvEditHistory.canUndoCsvEdit(activeModRoot.value, currentTab.value) : false,
  );
  const canRedoCurrentTableEdit = computed(() =>
    activeModRoot.value ? csvEditHistory.canRedoCsvEdit(activeModRoot.value, currentTab.value) : false,
  );
  const hasAnyTableChanges = computed(() => (activeModRoot.value ? hasModDirtyChanges(activeModRoot.value) : false));

  // --- Per-Mod lifecycle ---

  function initializeModTables(target: { sessionId: string; modRoot: string; manifest: ProjectManifest }) {
    for (const [key, lock] of identityLocks) {
      if (normalizeFsPath(lock.target.modRoot) === normalizeFsPath(target.modRoot)) identityLocks.delete(key);
    }
    const state = createModTableState();
    applyManifestSummaries(state, target.manifest);
    stateMap.set(target.modRoot, state);
    inputMap.get(target.modRoot)?.forEach((inputs) => inputs.release());
    inputMap.set(
      target.modRoot,
      new Map(TABLE_KEYS.map((table) => [table, createFieldInputs(ref(JSON.stringify([target.sessionId, target.modRoot, table])))])),
    );
  }

  function activateFor(modRoot: string | null, manifest?: ProjectManifest | null) {
    const state = modRoot ? stateMap.get(modRoot) : undefined;
    if (state && manifest) applyManifestSummaries(state, manifest);
  }

  function removeModState(modRoot: string) {
    for (const [key, lock] of identityLocks) {
      if (normalizeFsPath(lock.target.modRoot) === normalizeFsPath(modRoot)) identityLocks.delete(key);
    }
    inputMap.get(modRoot)?.forEach((inputs) => inputs.release());
    inputMap.delete(modRoot);
    stateMap.delete(modRoot);
  }

  function hasModDirtyChanges(modRoot: string): boolean {
    const state = stateMap.get(modRoot);
    if (!state) return false;
    return TABLE_KEYS.some((key) => inputMap.get(modRoot)?.get(key)?.dirty.value || hasCsvTableDraftChanges(state, key));
  }

  // Table unsaved state joins the unsaved-work registry for unified Mod-level queries.
  useDraftSessionsStore().registerDirtySource(hasModDirtyChanges);

  // --- Existing API ---

  function rowsFor(tab: CsvTableKey): CsvTableRows {
    const state = getActiveState();
    return state ? csvVisibleRowKeys(state, tab).map((key) => state.tables[tab][key] ?? null) : [];
  }

  function switchTab(modRoot: string, tab: CsvTableKey) {
    const state = stateMap.get(modRoot)!;
    if (state.currentTab === tab) return;
    state.currentTab = tab;
    state.selectedRowKey = null;
    state.searchText = '';
    state.searchField = DEFAULT_CSV_SEARCH_FIELD;
  }

  function applyTableIndex(target: CsvTableTarget, index: import('@/shared/types').DeepReadonly<CsvTableIndex>, filtered = false) {
    const state = stateMap.get(target.modRoot)!;
    applyCsvTableIndexDraft(state, index, filtered, getTableInputs(target.modRoot, target.table).dirty.value);
  }

  function applyTableRows(target: CsvTableTarget, rows: import('@/shared/types').DeepReadonly<CsvTableRowsRead>) {
    applyCsvTableRowsDraft(stateMap.get(target.modRoot)!, rows, getTableInputs(target.modRoot, target.table).dirty.value);
  }

  function hasTableDirtyChanges(tab: CsvTableKey): boolean {
    const state = getActiveState();
    if (!state) return false;
    return getTableInputs(activeModRoot.value!, tab).dirty.value || hasCsvTableDraftChanges(state, tab);
  }

  function markTableExternalUpdate(target: CsvTableTarget) {
    markCsvTableExternalUpdateDraft(stateMap.get(target.modRoot)!, target.table);
  }

  function clearTableExternalUpdate(target: CsvTableTarget) {
    clearCsvTableExternalUpdateDraft(stateMap.get(target.modRoot)!, target.table);
  }

  function setSearchText(target: CsvTableTarget, text: string) {
    stateMap.get(target.modRoot)!.searchText = text;
  }

  function setSearchField(target: CsvTableTarget, field: import('@/shared/types').CsvSearchField) {
    stateMap.get(target.modRoot)!.searchField = field;
  }

  function selectRowByKey(target: CsvTableTarget, rowKey: string | null) {
    const state = stateMap.get(target.modRoot)!;
    if (state.currentTab === target.table) state.selectedRowKey = rowKey;
  }

  const isDirty = computed(() => {
    const table = dirty.value[currentTab.value];
    return (rowKey: string, col: string) => csvDirtyCells(table[rowKey])?.[col] !== undefined;
  });

  function getTableInputs(modRoot: string, table: CsvTableKey): FieldInputs {
    return inputMap.get(modRoot)!.get(table)!;
  }

  function tableReadGeneration(modRoot: string, table: CsvTableKey) {
    return readGenerations.get(stateMap.get(modRoot)!)?.get(table) ?? 0;
  }

  function revokeTableReads(modRoot: string, table: CsvTableKey) {
    const state = stateMap.get(modRoot)!;
    const generations = readGenerations.get(state) ?? new Map<CsvTableKey, number>();
    generations.set(table, (generations.get(table) ?? 0) + 1);
    readGenerations.set(state, generations);
  }

  function setActiveCell(target: CsvCellTarget | null, modRoot: string) {
    const state = stateMap.get(modRoot);
    if (state) state.editing = target;
  }

  function updateCellValue(target: CsvCellTarget, value: string) {
    if (isTableLocked(target.modRoot, target.table)) return;
    const state = stateMap.get(target.modRoot)!;
    pushCsvDraftResult(target.table, setCsvCellValueDraft(state, target.table, target.rowKey, target.column, value), target.modRoot);
  }

  function undoCurrentTableEdit(): string | null {
    if (currentTableLocked.value) return null;
    return activeModRoot.value ? csvEditHistory.undoCsvEdit(activeModRoot.value, currentTab.value, getActiveState()) : null;
  }

  function redoCurrentTableEdit(): string | null {
    if (currentTableLocked.value) return null;
    return activeModRoot.value ? csvEditHistory.redoCsvEdit(activeModRoot.value, currentTab.value, getActiveState()) : null;
  }

  function addNewRow(): CsvRowTarget | null {
    if (currentTableLocked.value) return null;
    const state = getActiveState();
    if (!state) return null;
    const result = createCsvRowDraft(state, Date.now());
    pushCsvDraftResult(state.currentTab, result);
    return csvRowTargetOf(result);
  }

  function moveRow(target: CsvTableTarget, rowKey: string, nextIndex: number) {
    const state = stateMap.get(target.modRoot)!;
    if (
      saving.value ||
      isTableLocked(target.modRoot, target.table) ||
      state.searchText.trim() ||
      state.filteredRows[target.table] !== state.totalRows[target.table]
    )
      return;
    pushCsvDraftResult(target.table, moveCsvRowDraft(state, target.table, rowKey, nextIndex), target.modRoot);
  }

  function deleteSelected(): CsvRowTarget | null {
    if (currentTableLocked.value) return null;
    const state = getActiveState();
    if (!state) return null;
    const result = deleteSelectedCsvRowDraft(state);
    pushCsvDraftResult(state.currentTab, result);
    return csvRowTargetOf(result);
  }

  function getActiveModTableState(): ModTableState | undefined {
    return getActiveState();
  }

  function getModTableState(modRoot: string): ModTableState | undefined {
    return stateMap.get(modRoot);
  }

  function replaceTableForMod(modRoot: string, tab: CsvTableKey, rows: CsvDraftRow[]) {
    const state = stateMap.get(modRoot);
    if (!state) return;
    revokeTableReads(modRoot, tab);
    replaceCsvTableDraft(state, tab, rows);
  }

  function discardTableDraftForReload(target: CsvTableTarget) {
    revokeTableReads(target.modRoot, target.table);
    getTableInputs(target.modRoot, target.table).cancel();
    discardCsvTableWindowForReloadDraft(stateMap.get(target.modRoot)!, target.table);
  }

  function markTableSavedForMod(modRoot: string, tab: CsvTableKey) {
    const state = stateMap.get(modRoot);
    if (!state) return;
    markCsvTableSavedDraft(state, tab);
  }

  function applySavedRowKeyMapForMod(modRoot: string, tab: CsvTableKey, keyMap: CsvRowKeyMapping[]) {
    const state = stateMap.get(modRoot);
    if (!state) return;
    applySavedCsvRowKeyMapDraft(state, tab, keyMap);
  }

  function pushCsvDraftResult(table: CsvTableKey, result: CsvDraftResult, modRoot = activeModRoot.value) {
    if (!modRoot || !result.historyOperation || !result.historyLabel) return;
    csvEditHistory.pushCsvDraftOperation(modRoot, table, result.historyOperation, result.historyLabel);
  }

  function setSaving(value: boolean) {
    saving.value = value;
  }

  return {
    currentTableLocked,
    isTableLocked,
    lockTable,
    releaseTableLock,
    searchField,
    currentTab,
    currentHeader,
    activeModRoot,
    canRedoCurrentTableEdit,
    canUndoCurrentTableEdit,
    dirty,
    editing,
    filteredRowCount,
    filteredRows,
    rowKeys,
    rowsByKey,
    hasCurrentTableChanges,
    hasCurrentTableFilter,
    hasCurrentRowOrderChanges,
    moveRow,
    hasCurrentTableExternalUpdate,
    hasAnyTableChanges,
    hasAnyTableDirtyChanges,
    isDirty,
    rows,
    saving,
    searchText,
    selectedRow,
    selectedRowRecord,
    selectedRowKey,
    tableInfo,
    tables,
    visibleColumns,
    activateFor,
    addNewRow,
    deleteSelected,
    getTableInputs,
    tableReadGeneration,
    revokeTableReads,
    setActiveCell,
    getActiveModTableState,
    getModTableState,
    hasModDirtyChanges,
    initializeModTables,
    markTableSavedForMod,
    markTableExternalUpdate,
    removeModState,
    replaceTableForMod,
    discardTableDraftForReload,
    redoCurrentTableEdit,
    rowsFor,
    selectRowByKey,
    setSaving,
    setSearchText,
    setSearchField,
    clearTableExternalUpdate,
    switchTab,
    applySavedRowKeyMapForMod,
    applyTableIndex,
    applyTableRows,
    hasTableDirtyChanges,
    undoCurrentTableEdit,
    updateCellValue,
  };
});
