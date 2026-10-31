import { useProjectSyncStore } from '@/stores/project-sync.store';
import type { DocumentEditorActions } from '@/shared/runtime/document-editor';
import {
  canRedoEntry,
  canUndoEntry,
  createUndoStackState,
  nextUndoStackId,
  peekRedoEntry,
  peekUndoEntry,
  popRedoEntry,
  popUndoEntry,
  pushRedoEntry,
  pushUndoEntry,
  setUndoStackLimit,
  type UndoStackState,
} from '@/domain/edit-session';
import {
  type CsvTableState,
  type CsvTableHistoryEntry,
  type CsvDraftOperation,
  type CsvCellTarget,
  type CsvTableTarget,
  TABLE_KEYS,
  type CsvRowKeyMapping,
  type CsvTableRows,
  type CsvTableIndex,
  type CsvTableRowsRead,
  type CsvModState,
  type ProjectManifest,
  type CsvDraftRow,
  type CsvTableKey,
} from '@/shared/types';
import { defineStore } from 'pinia';
import { computed, markRaw, reactive, ref, shallowReactive, type Raw } from 'vue';
import { createFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';

import { normalizeFsPath } from '@/shared/lib/paths';

import { csvColumnsForTable } from '@/domain/csv-editor/csv-column-schema';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { csvDirtyCells } from '@/domain/csv-editor/csv-dirty';
import { DEFAULT_CSV_SEARCH_FIELD } from '@/domain/csv-editor/csv-search';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import {
  applyCsvDraftOperation,
  applyCsvTableIndexDraft,
  acceptSavedCsvTableIndex,
  acceptSavedCsvTableRows,
  applyCsvTableRowsDraft,
  csvVisibleRowKeys,
  clearCsvTableExternalUpdateDraft,
  createCsvRowDraft,
  copyCsvRowDraft,
  deleteCsvRowDraft,
  discardCsvTableWindowForReloadDraft,
  hasCsvTableDraftChanges,
  markCsvTableExternalUpdateDraft,
  replaceCsvTableDraft,
  setCsvCellValueDraft,
  csvRowTargetOf,
  type CsvDraftResult,
  type CsvRowTarget,
  moveCsvRowDraft,
  hasCsvRowOrderChanges,
} from '@/domain/csv-editor/csv-table-draft';
import { isLoadedCsvTableRow } from '@/domain/csv-editor/csv-table-rows';

interface CsvTableRuntime extends CsvTableState {
  inputs: Raw<FieldInputs>;
  history: UndoStackState<CsvTableHistoryEntry>;
  readGeneration: number;
  saving: boolean;
  saveActions: Raw<Pick<DocumentEditorActions<CsvTableTarget>, 'save' | 'waitForSave' | 'saving'>> | null;
  editor: Raw<DocumentEditorActions<CsvTableTarget>> | null;
}
interface CsvModRuntime extends Omit<CsvModState, 'documents'> {
  documents: Record<CsvTableKey, CsvTableRuntime>;
}
function createCsvModRuntime(target: { sessionId: string; modRoot: string }, limit: number): CsvModRuntime {
  return {
    documents: Object.fromEntries(
      TABLE_KEYS.map((table): [CsvTableKey, CsvTableRuntime] => [
        table,
        {
          table,
          nextRowKey: 0,
          rowOrder: [],
          baselineRowOrder: [],
          baseVersions: [],
          rows: {},
          baselineRows: {},
          header: [],
          totalRowCount: 0,
          filteredRowCount: 0,
          dirty: {},
          externalUpdatePending: false,
          inputs: markRaw(createFieldInputs(ref(JSON.stringify([target.sessionId, target.modRoot, table])))),
          history: createUndoStackState<CsvTableHistoryEntry>(limit),
          readGeneration: 0,
          saving: false,
          saveActions: null,
          editor: null,
        },
      ]),
    ) as Record<CsvTableKey, CsvTableRuntime>,
    currentTab: 'ships',
    searchField: DEFAULT_CSV_SEARCH_FIELD,
    searchText: '',
    selectedRowKey: null,
    editing: null,
  };
}

function applyManifestSummaries(state: CsvModState, manifest: ProjectManifest) {
  for (const key of TABLE_KEYS) {
    const summary = manifest.tableSummaries[key];
    state.documents[key].header = summary.header;
    if (summary.totalRows !== null) {
      state.documents[key].totalRowCount = summary.totalRows;
      state.documents[key].filteredRowCount = summary.totalRows;
    }
  }
}

export const useCsvEditorStore = defineStore('csv-editor', () => {
  const workspace = useWorkspaceStore();
  const historyLimit = ref(100);
  const stateMap = reactive<Map<string, CsvModRuntime>>(new Map());
  const identityLocks = shallowReactive(new Map<string, { target: CsvTableTarget; owner: string }>());
  const lockKey = (root: string, table: CsvTableKey) => JSON.stringify([normalizeFsPath(root), table]);
  const activeModRoot = computed(() => workspace.activeModRoot);
  const currentTab = computed(() => getActiveState()?.currentTab ?? 'ships');
  const saving = computed(() => getActiveState()?.documents[currentTab.value].saving ?? false);
  const currentTableLocked = computed(() => (activeModRoot.value ? isTableLocked(activeModRoot.value, currentTab.value) : false));
  const searchField = computed(() => getActiveState()?.searchField ?? DEFAULT_CSV_SEARCH_FIELD);
  const currentHeader = computed(() => getActiveState()?.documents[currentTab.value].header ?? []);
  const searchText = computed(() => getActiveState()?.searchText ?? '');
  const selectedRowKey = computed(() => getActiveState()?.selectedRowKey ?? null);
  const editing = computed(() => getActiveState()?.editing ?? null);
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
  const rowKeys = computed(() => {
    const state = getActiveState();
    return state ? csvVisibleRowKeys(state.documents[currentTab.value]) : [];
  });
  const rowsByKey = computed(() => getActiveState()?.documents[currentTab.value].rows ?? {});
  const totalRowCount = computed(() => getActiveState()?.documents[currentTab.value].totalRowCount ?? 0);
  const filteredRowCount = computed(() => getActiveState()?.documents[currentTab.value].filteredRowCount ?? 0);
  const hasCurrentTableFilter = computed(
    () => Boolean(searchText.value.trim()) || filteredRowCount.value !== (getActiveState()?.documents[currentTab.value].totalRowCount ?? 0),
  );
  const selectedRowRecord = computed(() =>
    selectedRowKey.value ? getActiveState()?.documents[currentTab.value].rows[selectedRowKey.value] : undefined,
  );
  const selectedRow = computed(() => selectedRowRecord.value?.data);
  const tableInfo = computed(() => {
    const state = getActiveState();
    if (!state) return '显示 0 / 0 行';
    return `显示 ${state.documents[state.currentTab].filteredRowCount} / ${state.documents[state.currentTab].totalRowCount} 行`;
  });
  const hasCurrentRowOrderChanges = computed(() => {
    const state = getActiveState();
    return state ? hasCsvRowOrderChanges(state.documents[currentTab.value]) : false;
  });
  const hasCurrentTableChanges = computed(() => {
    const state = getActiveState();
    if (!state) return false;
    return hasTableDirtyChanges(state.currentTab);
  });
  const hasCurrentTableExternalUpdate = computed(() => {
    const state = getActiveState();
    return state ? state.documents[state.currentTab].externalUpdatePending : false;
  });
  const isDirty = computed(() => {
    const table = getActiveState()?.documents[currentTab.value].dirty ?? {};
    return (rowKey: string, col: string) => csvDirtyCells(table[rowKey])?.[col] !== undefined;
  });
  const activeEditor = computed(() =>
    workspace.activeSessionId && activeModRoot.value && stateMap.has(activeModRoot.value)
      ? getTableEditor({ sessionId: workspace.activeSessionId, modRoot: activeModRoot.value, table: currentTab.value })
      : null,
  );

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

  function getActiveState(): CsvModRuntime | undefined {
    return activeModRoot.value ? stateMap.get(activeModRoot.value) : undefined;
  }

  function hasModDirtyChanges(modRoot: string): boolean {
    const state = stateMap.get(modRoot);
    if (!state) return false;
    return TABLE_KEYS.some((key) => state.documents[key].inputs.dirty.value || hasCsvTableDraftChanges(state.documents[key]));
  }

  function rowsFor(tab: CsvTableKey): CsvTableRows {
    const state = getActiveState();
    return state ? csvVisibleRowKeys(state.documents[tab]).map((key) => state.documents[tab].rows[key] ?? null) : [];
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
    applyCsvTableIndexDraft(state.documents[target.table], index, filtered, getTableInputs(target.modRoot, target.table).dirty.value);
  }

  function acceptSavedTableIndex(target: CsvTableTarget, index: import('@/shared/types').DeepReadonly<CsvTableIndex>, filtered = false) {
    acceptSavedCsvTableIndex(stateMap.get(target.modRoot)!.documents[target.table], index, filtered);
  }

  function acceptSavedTableRows(target: CsvTableTarget, rows: import('@/shared/types').DeepReadonly<CsvTableRowsRead>) {
    acceptSavedCsvTableRows(stateMap.get(target.modRoot)!.documents[target.table], rows.rows);
  }

  function applyTableRows(target: CsvTableTarget, rows: import('@/shared/types').DeepReadonly<CsvTableRowsRead>) {
    applyCsvTableRowsDraft(
      stateMap.get(target.modRoot)!.documents[target.table],
      rows,
      getTableInputs(target.modRoot, target.table).dirty.value,
    );
  }

  function hasTableDirtyChanges(tab: CsvTableKey): boolean {
    const state = getActiveState();
    if (!state) return false;
    return getTableInputs(activeModRoot.value!, tab).dirty.value || hasCsvTableDraftChanges(state.documents[tab]);
  }

  function markTableExternalUpdate(target: CsvTableTarget) {
    markCsvTableExternalUpdateDraft(stateMap.get(target.modRoot)!.documents[target.table]);
  }

  function clearTableExternalUpdate(target: CsvTableTarget) {
    clearCsvTableExternalUpdateDraft(stateMap.get(target.modRoot)!.documents[target.table]);
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

  function getTableInputs(modRoot: string, table: CsvTableKey): FieldInputs {
    return stateMap.get(modRoot)!.documents[table].inputs;
  }

  function tableReadGeneration(modRoot: string, table: CsvTableKey) {
    return stateMap.get(modRoot)!.documents[table].readGeneration;
  }

  function revokeTableReads(modRoot: string, table: CsvTableKey) {
    stateMap.get(modRoot)!.documents[table].readGeneration++;
  }

  function setActiveCell(target: CsvCellTarget | null, modRoot: string) {
    const state = stateMap.get(modRoot);
    if (state) state.editing = target;
  }

  function updateCellValue(target: CsvCellTarget, value: string) {
    if (isTableLocked(target.modRoot, target.table)) return;
    const state = stateMap.get(target.modRoot)!;
    pushCsvDraftResult(
      target.table,
      setCsvCellValueDraft(state.documents[target.table], target.rowKey, target.column, value),
      target.modRoot,
    );
  }

  function addNewRow(): CsvRowTarget | null {
    if (currentTableLocked.value) return null;
    const state = getActiveState();
    if (!state) return null;
    const result = createCsvRowDraft(state.documents[state.currentTab], state.selectedRowKey, Date.now());
    state.selectedRowKey = csvRowTargetOf(result)!.rowKey;
    pushCsvDraftResult(state.currentTab, result);
    return csvRowTargetOf(result);
  }

  function rowDragDisabled(target: CsvTableTarget) {
    const state = stateMap.get(target.modRoot)!;
    return (
      isTableLocked(target.modRoot, target.table) ||
      Boolean(state.searchText.trim()) ||
      state.documents[target.table].filteredRowCount !== state.documents[target.table].totalRowCount
    );
  }

  function moveRow(target: CsvTableTarget, rowKey: string, nextIndex: number) {
    if (rowDragDisabled(target)) return;
    const state = stateMap.get(target.modRoot)!;
    const result = moveCsvRowDraft(state.documents[target.table], rowKey, nextIndex);
    if (result.changed && state.currentTab === target.table) state.selectedRowKey = rowKey;
    pushCsvDraftResult(target.table, result, target.modRoot);
  }

  function copyRow(target: CsvTableTarget, rowKey: string, rowIndex: number) {
    if (rowDragDisabled(target)) return;
    const state = stateMap.get(target.modRoot)!;
    const result = copyCsvRowDraft(state.documents[target.table], rowKey, rowIndex);
    if (state.currentTab === target.table) state.selectedRowKey = csvRowTargetOf(result)!.rowKey;
    pushCsvDraftResult(target.table, result, target.modRoot);
  }

  function deleteSelected(): CsvRowTarget | null {
    if (currentTableLocked.value) return null;
    const state = getActiveState();
    if (!state) return null;
    if (!state.selectedRowKey) return null;
    const result = deleteCsvRowDraft(state.documents[state.currentTab], state.selectedRowKey);
    state.selectedRowKey = null;
    state.editing = null;
    pushCsvDraftResult(state.currentTab, result);
    return csvRowTargetOf(result);
  }

  function getCsvModState(modRoot: string): CsvModRuntime | undefined {
    return stateMap.get(modRoot);
  }

  function replaceTableForMod(modRoot: string, tab: CsvTableKey, rows: CsvDraftRow[]) {
    const state = stateMap.get(modRoot);
    if (!state) return;
    revokeTableReads(modRoot, tab);
    replaceCsvTableDraft(state.documents[tab], rows);
  }

  function discardTableDraftForReload(target: CsvTableTarget) {
    revokeTableReads(target.modRoot, target.table);
    getTableInputs(target.modRoot, target.table).cancel();
    const state = stateMap.get(target.modRoot)!;
    discardCsvTableWindowForReloadDraft(state.documents[target.table]);
    if (state.currentTab === target.table) {
      state.selectedRowKey = null;
      state.editing = null;
    }
  }

  function pushCsvDraftResult(table: CsvTableKey, result: CsvDraftResult, modRoot = activeModRoot.value) {
    if (!modRoot || !result.historyOperation || !result.historyLabel) return;
    pushCsvTableOperation(modRoot, table, result.historyOperation, result.historyLabel);
  }

  function getStack(modRoot: string, table: CsvTableKey) {
    return stateMap.get(modRoot)?.documents[table].history;
  }

  function pushCsvTableOperation(modRoot: string, table: CsvTableKey, operation: CsvDraftOperation, label: string) {
    if (!modRoot) return;
    const stack = getStack(modRoot, table)!;
    pushUndoEntry(stack, { id: nextUndoStackId(stack, 'csv_edit'), timestamp: Date.now(), operation, label });
  }

  function canUndoCsvTable(modRoot: string, table: CsvTableKey): boolean {
    const stack = getStack(modRoot, table);
    return stack ? canUndoEntry(stack) : false;
  }

  function canRedoCsvTable(modRoot: string, table: CsvTableKey): boolean {
    const stack = getStack(modRoot, table);
    return stack ? canRedoEntry(stack) : false;
  }

  function undoCsvTable(modRoot: string, table: CsvTableKey, tableState: CsvModState | undefined): string | null {
    const stack = getStack(modRoot, table);
    const entry = stack ? peekUndoEntry(stack) : undefined;
    if (!stack || !entry) return null;
    if (!tableState || !applyCsvDraftOperation(tableState.documents[table], entry.operation, 'undo')) return null;
    reconcileSelection(tableState, table, entry.operation);
    popUndoEntry(stack);
    pushRedoEntry(stack, entry);
    return entry.label;
  }

  function redoCsvTable(modRoot: string, table: CsvTableKey, tableState: CsvModState | undefined): string | null {
    const stack = getStack(modRoot, table);
    const entry = stack ? peekRedoEntry(stack) : undefined;
    if (!stack || !entry) return null;
    if (!tableState || !applyCsvDraftOperation(tableState.documents[table], entry.operation, 'redo')) return null;
    reconcileSelection(tableState, table, entry.operation);
    popRedoEntry(stack);
    pushUndoEntry(stack, entry, { clearRedo: false });
    return entry.label;
  }

  function reconcileSelection(state: CsvModState, table: CsvTableKey, operation: CsvDraftOperation) {
    if (state.currentTab !== table) return;
    if (operation.type === 'row-moved') state.selectedRowKey = operation.rowKey;
    if (state.selectedRowKey && !state.documents[table].rows[state.selectedRowKey]) state.selectedRowKey = null;
    if (state.editing?.table === table && !state.documents[table].rows[state.editing.rowKey]) state.editing = null;
  }

  function clearCsvTableHistory(modRoot: string, table: CsvTableKey) {
    const state = stateMap.get(modRoot);
    if (state) state.documents[table].history = createUndoStackState<CsvTableHistoryEntry>(historyLimit.value);
  }

  function applySavedRowKeyMap(modRoot: string, table: CsvTableKey, keyMap: CsvRowKeyMapping[]) {
    const stack = getStack(modRoot, table);
    if (!stack) return;
    const state = stateMap.get(modRoot)!;
    const mapped = new Map(keyMap.map((item) => [item.previousKey, item.nextKey]));
    if (state.currentTab === table && state.selectedRowKey) state.selectedRowKey = mapped.get(state.selectedRowKey) ?? state.selectedRowKey;
    if (state.editing?.table === table) state.editing.rowKey = mapped.get(state.editing.rowKey) ?? state.editing.rowKey;
    for (const entry of [...stack.undoStack, ...stack.redoStack]) {
      entry.operation.rowKey = mapped.get(entry.operation.rowKey) ?? entry.operation.rowKey;
      if (entry.operation.type === 'row-created' || entry.operation.type === 'row-deleted') {
        entry.operation.row.rowKey = entry.operation.rowKey;
      }
    }
  }

  function captureSaveHistory(modRoot: string, table: CsvTableKey) {
    const stack = getStack(modRoot, table);
    return {
      undoIds: new Set(stack?.undoStack.map((entry) => entry.id) ?? []),
      redoIds: new Set(stack?.redoStack.map((entry) => entry.id) ?? []),
    };
  }

  function commitSaveHistory(modRoot: string, table: CsvTableKey, submitted: ReturnType<typeof captureSaveHistory>) {
    const stack = getStack(modRoot, table);
    if (!stack) return;
    stack.undoStack = stack.undoStack.filter((entry) => !submitted.undoIds.has(entry.id));
    stack.redoStack = stack.redoStack.filter((entry) => !submitted.redoIds.has(entry.id));
  }

  function setHistoryLimit(limit: number) {
    historyLimit.value = limit;
    for (const state of stateMap.values())
      for (const document of Object.values(state.documents)) setUndoStackLimit(document.history, limit);
  }

  function setSaving(target: CsvTableTarget, value: boolean) {
    stateMap.get(target.modRoot)!.documents[target.table].saving = value;
  }

  function isTableSaving(modRoot: string, table: CsvTableKey) {
    return stateMap.get(modRoot)!.documents[table].saving;
  }

  function getTableEditor(target: CsvTableTarget): DocumentEditorActions<CsvTableTarget> {
    const state = stateMap.get(target.modRoot)!;
    const runtime = state.documents[target.table];
    if (runtime.editor) return runtime.editor;
    const inputs = runtime.inputs;
    async function replay(direction: 'undo' | 'redo') {
      const committed = inputs.commit();
      if (committed && !(await committed)) return false;
      if (stateMap.get(target.modRoot) !== state || isTableLocked(target.modRoot, target.table)) return false;
      if (!(direction === 'undo' ? canUndoCsvTable(target.modRoot, target.table) : canRedoCsvTable(target.modRoot, target.table)))
        return null;
      inputs.cancel();
      return (
        (direction === 'undo' ? undoCsvTable(target.modRoot, target.table, state) : redoCsvTable(target.modRoot, target.table, state)) !==
        null
      );
    }
    return (runtime.editor = markRaw({
      save: () => runtime.saveActions!.save(),
      waitForSave: () => runtime.saveActions!.waitForSave(),
      target: computed(() => target),
      targetKey: inputs.targetKey,
      inputs,
      dirty: computed(() => hasCsvTableDraftChanges(state.documents[target.table]) || inputs.dirty.value),
      saving: computed(() => runtime.saving || (runtime.saveActions?.saving.value ?? false)),
      canUndo: computed(() => canUndoCsvTable(target.modRoot, target.table) || inputs.dirty.value),
      canRedo: computed(() => canRedoCsvTable(target.modRoot, target.table) || inputs.dirty.value),
      undo: () => replay('undo'),
      redo: () => replay('redo'),
    }));
  }

  function bindSaveActions(
    target: CsvTableTarget,
    actions: Pick<DocumentEditorActions<CsvTableTarget>, 'save' | 'waitForSave' | 'saving'>,
  ) {
    const runtime = stateMap.get(target.modRoot)!.documents[target.table];
    runtime.saveActions = markRaw(actions);
    return getTableEditor(target);
  }

  function initializeModTables(target: { sessionId: string; modRoot: string; manifest: ProjectManifest }) {
    for (const [key, lock] of identityLocks) {
      if (normalizeFsPath(lock.target.modRoot) === normalizeFsPath(target.modRoot)) identityLocks.delete(key);
    }
    const state = createCsvModRuntime(target, historyLimit.value);
    stateMap.get(target.modRoot) && Object.values(stateMap.get(target.modRoot)!.documents).forEach((document) => document.inputs.release());
    applyManifestSummaries(state, target.manifest);
    stateMap.set(target.modRoot, state);
  }

  function activateFor(modRoot: string | null, manifest?: ProjectManifest | null) {
    const state = modRoot ? stateMap.get(modRoot) : undefined;
    if (state && manifest) applyManifestSummaries(state, manifest);
  }

  function removeModState(modRoot: string) {
    for (const [key, lock] of identityLocks) {
      if (normalizeFsPath(lock.target.modRoot) === normalizeFsPath(modRoot)) identityLocks.delete(key);
    }
    if (stateMap.has(modRoot)) for (const document of Object.values(stateMap.get(modRoot)!.documents)) document.inputs.release();
    stateMap.delete(modRoot);
  }

  useDraftSessionsStore().registerDirtySource(hasModDirtyChanges);

  return {
    activeModRoot,
    currentTab,
    activeEditor,
    bindSaveActions,
    getCsvModState,

    rows,
    rowKeys,
    rowsByKey,
    totalRowCount,
    filteredRowCount,
    selectedRow,
    selectedRowRecord,
    selectedRowKey,
    currentHeader,
    visibleColumns,
    tableInfo,
    searchText,
    searchField,
    hasCurrentTableFilter,
    isDirty,

    currentTableLocked,
    isTableLocked,
    canSaveCurrentTable: computed(
      () =>
        !useProjectSyncStore().isWaiting(workspace.activeModRoot) &&
        (hasCurrentTableChanges.value ||
          Boolean(workspace.activeManifest && !workspace.activeManifest.tableSummaries[currentTab.value].available)),
    ),
    hasCurrentTableChanges,
    hasCurrentRowOrderChanges,
    hasCurrentTableExternalUpdate,
    hasTableDirtyChanges,

    getTableInputs,
    editing,
    setActiveCell,
    updateCellValue,
    addNewRow,
    deleteSelected,
    moveRow,
    copyRow,
    selectRowByKey,
    setSearchText,
    setSearchField,
    switchTab,
    lockTable,
    releaseTableLock,

    saving,
    setSaving,
    isTableSaving,
    applySavedRowKeyMap,
    captureSaveHistory,
    commitSaveHistory,
    clearCsvTableHistory,
    setHistoryLimit,

    initializeModTables,
    activateFor,
    removeModState,
    tableReadGeneration,
    revokeTableReads,
    replaceTableForMod,
    discardTableDraftForReload,
    applyTableIndex,
    acceptSavedTableIndex,
    acceptSavedTableRows,
    applyTableRows,
    markTableExternalUpdate,
    clearTableExternalUpdate,
  };
});
