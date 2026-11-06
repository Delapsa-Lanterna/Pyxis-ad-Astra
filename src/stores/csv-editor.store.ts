import { useProjectStore } from '@/stores/project.store';
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
  type CsvDraftEdit,
  type CsvSingleEdit,
  type CsvCellTarget,
  type CsvTableTarget,
  TABLE_KEYS,
  type CsvRowKeyMapping,
  type CsvTableIndex,
  type CsvTableRowsRead,
  type CsvModState,
  type ProjectManifest,
  type CsvDraftRow,
  type CsvTableKey,
  type DeepReadonly,
  type CsvSearchField,
  type CsvValidationContext,
} from '@/shared/types';
import { recordQueuedLog, shouldQueueLog, infoLog } from '@/shared/runtime/app-log-queue';
import { logFields } from '@/shared/lib/log-fields';
import { defineStore } from 'pinia';
import { computed, markRaw, reactive, ref, shallowReactive, type Raw } from 'vue';
import { createFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';

import { normalizeFsPath } from '@/shared/lib/paths';

import { DEFAULT_CSV_SEARCH_FIELD } from '@/domain/csv-editor/csv-search';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import {
  applyCsvDraftEdit,
  applyCsvTableIndexDraft,
  acceptSavedCsvTableIndex,
  acceptSavedCsvTableRows,
  applyCsvTableRowsDraft,
  clearCsvTableExternalUpdateDraft,
  createCsvRowDraft,
  deleteCsvRowDraft,
  discardCsvTableWindowForReloadDraft,
  hasCsvTableDraftChanges,
  markCsvTableExternalUpdateDraft,
  replaceCsvTableDraft,
  setCsvCellValueDraft,
  writeCsvRangeDraft,
  moveCsvRowsDraft,
  insertCsvRowsDraft,
  deleteCsvRowsDraft,
  csvRowTargetOf,
  type CsvDraftResult,
  type CsvRowTarget,
} from '@/domain/csv-editor/csv-table-draft';

import { createEditorProblems } from '@/shared/runtime/editor-problems';
import { csvTableIssues } from '@/domain/csv-editor/csv-validation';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

interface CsvTableRuntime extends CsvTableState {
  problems: Raw<ReturnType<typeof createEditorProblems>> | null;
  inputs: Raw<FieldInputs>;
  history: UndoStackState<CsvTableHistoryEntry>;
  readGeneration: number;
  saving: boolean;
  saveActions: Raw<Pick<DocumentEditorActions<CsvTableTarget>, 'save' | 'waitForSave' | 'saving'>> | null;
  editor: Raw<DocumentEditorActions<CsvTableTarget>> | null;
}
interface CsvModRuntime extends Omit<CsvModState, 'documents'> {
  sessionId: string;
  documents: Record<CsvTableKey, CsvTableRuntime>;
}
function createCsvModRuntime(target: { sessionId: string; modRoot: string }, limit: number): CsvModRuntime {
  return {
    sessionId: target.sessionId,
    documents: Object.fromEntries(
      TABLE_KEYS.map((table): [CsvTableKey, CsvTableRuntime] => [
        table,
        {
          table,
          nextRowKey: 0,
          validationRows: null,
          validationContext: null,
          validationKey: '',
          problems: null,
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

function applyTableSummaries(state: CsvModState, summaries: ProjectManifest['tableSummaries']) {
  for (const key of TABLE_KEYS) {
    const summary = summaries[key];
    state.documents[key].header = summary.header;
    if (summary.totalRows !== null) {
      state.documents[key].totalRowCount = summary.totalRows;
      state.documents[key].filteredRowCount = summary.totalRows;
    }
  }
}

export const useCsvEditorStore = defineStore('csv-editor', () => {
  const historyLimit = ref(100);
  const stateMap = reactive<Map<string, CsvModRuntime>>(new Map());
  const identityLocks = shallowReactive(new Map<string, { target: CsvTableTarget; owner: string }>());
  const lockKey = (root: string, table: CsvTableKey) => JSON.stringify([normalizeFsPath(root), table]);

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

  function hasModDirtyChanges(modRoot: string): boolean {
    const state = stateMap.get(modRoot);
    if (!state) return false;
    return TABLE_KEYS.some((key) => state.documents[key].inputs.dirty.value || hasCsvTableDraftChanges(state.documents[key]));
  }

  function switchTab(modRoot: string, tab: CsvTableKey) {
    const state = stateMap.get(modRoot)!;
    if (state.currentTab === tab) return;
    state.currentTab = tab;
    state.selectedRowKey = null;
    state.searchText = '';
    state.searchField = DEFAULT_CSV_SEARCH_FIELD;
  }

  function applyTableIndex(target: CsvTableTarget, index: DeepReadonly<CsvTableIndex>, filtered = false) {
    const state = stateMap.get(target.modRoot)!;
    const document = state.documents[target.table],
      query = !filtered && state.searchText.trim() ? document.queryRowKeys : undefined;
    const versions = document.baseVersions;
    const result = applyCsvTableIndexDraft(document, index, filtered, getTableInputs(target.modRoot, target.table).dirty.value);
    if (result.changed && !stableDeepEqual(versions, document.baseVersions)) {
      clearCsvTableHistory(target.modRoot, target.table);
      document.inputs.cancel();
      if (state.currentTab === target.table) state.editing = null;
    }
    if (document.validationRows) markRaw(document.validationRows);
    if (query) {
      document.queryRowKeys = query;
      document.filteredRowCount = query.length;
    }
  }

  function acceptSavedTableIndex(target: CsvTableTarget, index: DeepReadonly<CsvTableIndex>, filtered = false) {
    acceptSavedCsvTableIndex(stateMap.get(target.modRoot)!.documents[target.table], index, filtered);
    markRaw(stateMap.get(target.modRoot)!.documents[target.table].validationRows!);
  }

  function acceptSavedTableRows(target: CsvTableTarget, rows: DeepReadonly<CsvTableRowsRead>) {
    acceptSavedCsvTableRows(stateMap.get(target.modRoot)!.documents[target.table], rows.rows);
  }

  function applyTableRows(target: CsvTableTarget, rows: DeepReadonly<CsvTableRowsRead>) {
    applyCsvTableRowsDraft(
      stateMap.get(target.modRoot)!.documents[target.table],
      rows,
      getTableInputs(target.modRoot, target.table).dirty.value,
    );
  }

  function hasTableDirtyChanges(target: CsvTableTarget): boolean {
    const state = stateMap.get(target.modRoot);
    if (!state) return false;
    return getTableInputs(target.modRoot, target.table).dirty.value || hasCsvTableDraftChanges(state.documents[target.table]);
  }

  function canSaveTable(target: CsvTableTarget) {
    return (
      !useProjectSyncStore().isWaiting(target.modRoot) &&
      (hasTableDirtyChanges(target) || !useProjectStore().getManifest(target.modRoot)!.tableSummaries[target.table].available)
    );
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

  function setSearchField(target: CsvTableTarget, field: CsvSearchField) {
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

  function addNewRow(target: CsvTableTarget): CsvRowTarget | null {
    if (isTableLocked(target.modRoot, target.table)) return null;
    const state = stateMap.get(target.modRoot);
    if (!state) return null;
    const result = createCsvRowDraft(state.documents[target.table], state.selectedRowKey, Date.now());
    state.selectedRowKey = csvRowTargetOf(result)!.rowKey;
    pushCsvDraftResult(target.table, result, target.modRoot);
    return csvRowTargetOf(result);
  }

  function updateRange(target: CsvTableTarget, rowKeys: string[], columns: string[], values: string[][]) {
    const state = stateMap.get(target.modRoot)!;
    const keys = [...rowKeys];
    pushCsvDraftResult(target.table, writeCsvRangeDraft(state.documents[target.table], keys, columns, values), target.modRoot);
    return keys;
  }

  function rowDragDisabled(target: CsvTableTarget) {
    const state = stateMap.get(target.modRoot)!;
    return (
      isTableLocked(target.modRoot, target.table) ||
      Boolean(state.searchText.trim()) ||
      state.documents[target.table].filteredRowCount !== state.documents[target.table].totalRowCount
    );
  }

  function moveRows(target: CsvTableTarget, keys: string[], boundary: number) {
    if (rowDragDisabled(target)) return;
    const state = stateMap.get(target.modRoot)!;
    const result = moveCsvRowsDraft(state.documents[target.table], keys, boundary);
    if (result.changed && state.currentTab === target.table) state.selectedRowKey = keys[0]!;
    pushCsvDraftResult(target.table, result, target.modRoot);
  }
  function insertRows(target: CsvTableTarget, rows: CsvDraftRow[], boundary: number) {
    const { result, keys } = insertCsvRowsDraft(stateMap.get(target.modRoot)!.documents[target.table], rows, boundary);
    pushCsvDraftResult(target.table, result, target.modRoot);
    return keys;
  }
  function copyRows(target: CsvTableTarget, keys: string[], boundary: number) {
    const document = stateMap.get(target.modRoot)!.documents[target.table];
    const copied = insertRows(
      target,
      keys.map((key) => document.rows[key]!),
      boundary,
    );
    keys.forEach((rowKey, index) =>
      infoLog('tables.row_copied', () => ({
        ...target,
        rowKey,
        nextKey: copied[index]!,
        id: String(document.rows[rowKey]!.data[target.table === 'simOpponents' ? 'variant id' : 'id'] ?? ''),
      })),
    );
    return copied;
  }
  function deleteRows(target: CsvTableTarget, keys: string[]) {
    const state = stateMap.get(target.modRoot)!;
    pushCsvDraftResult(target.table, deleteCsvRowsDraft(state.documents[target.table], keys), target.modRoot);
    if (state.currentTab === target.table && keys.includes(state.selectedRowKey!)) state.selectedRowKey = null;
  }

  function deleteSelectedRow(target: CsvTableTarget): CsvRowTarget | null {
    if (isTableLocked(target.modRoot, target.table)) return null;
    const state = stateMap.get(target.modRoot);
    if (!state) return null;
    if (!state.selectedRowKey) return null;
    const result = deleteCsvRowDraft(state.documents[target.table], state.selectedRowKey);
    state.selectedRowKey = null;
    state.editing = null;
    pushCsvDraftResult(target.table, result, target.modRoot);
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
    clearCsvTableHistory(target.modRoot, target.table);
    getTableInputs(target.modRoot, target.table).cancel();
    const state = stateMap.get(target.modRoot)!;
    discardCsvTableWindowForReloadDraft(state.documents[target.table]);
    if (state.currentTab === target.table) {
      state.selectedRowKey = null;
      state.editing = null;
    }
  }

  function pushCsvDraftResult(table: CsvTableKey, result: CsvDraftResult, modRoot: string) {
    if (!modRoot || !result.historyEdit || !result.historyLabel) return;
    pushCsvTableEdit(modRoot, table, result.historyEdit, result.historyLabel);
  }

  function recordCsvEdit(modRoot: string, table: CsvTableKey, entry: CsvTableHistoryEntry, direction: string) {
    const document = stateMap.get(modRoot)!.documents[table];
    const steps = (entry.edit.type === 'batch' ? entry.edit.edits : [entry.edit]).filter((step) =>
      shouldQueueLog(direction === 'edit' && (step.type === 'cell-value-set' || step.type === 'row-moved') ? 'debug' : 'info'),
    );
    const movements = new Map<string, Extract<CsvSingleEdit, { type: 'row-moved' }>>();
    for (const step of steps)
      if (step.type === 'row-moved')
        movements.set(step.rowKey, { ...step, previousIndex: movements.get(step.rowKey)?.previousIndex ?? step.previousIndex });
    if (movements.size) {
      const otherOrder = [...document.rowOrder];
      for (const step of direction === 'undo' ? steps : [...steps].reverse())
        if (step.type === 'row-moved') {
          otherOrder.splice(otherOrder.indexOf(step.rowKey), 1);
          otherOrder.splice(direction === 'undo' ? step.nextIndex : step.previousIndex, 0, step.rowKey);
        }
      for (const move of movements.values()) {
        move.previousIndex = (direction === 'undo' ? document.rowOrder : otherOrder).indexOf(move.rowKey);
        move.nextIndex = (direction === 'undo' ? otherOrder : document.rowOrder).indexOf(move.rowKey);
      }
    }
    const edits: CsvSingleEdit[] = [...steps.filter((step) => step.type !== 'row-moved'), ...movements.values()];
    for (const [index, edit] of edits.entries()) {
      const level = direction === 'edit' && (edit.type === 'cell-value-set' || edit.type === 'row-moved') ? 'debug' : 'info';
      if (!shouldQueueLog(level)) continue;
      const row = 'row' in edit ? edit.row : (document.rows[edit.rowKey] ?? document.baselineRows[edit.rowKey]);
      const idField = table === 'simOpponents' ? 'variant id' : 'id';
      const id = row?.data[idField];
      const ids = edit.type === 'cell-value-set' && edit.col === idField ? [edit.previousValue, edit.newValue] : [null, null];
      if (direction === 'undo') ids.reverse();
      recordQueuedLog({
        level,
        code: 'tables.' + (direction === 'edit' ? edit.type.replaceAll('-', '_') : direction),
        message: null,
        path: document.baseVersions[0]?.path ?? null,
        line: null,
        fields: logFields({
          modRoot,
          sessionId: stateMap.get(modRoot)!.sessionId,
          table,
          operationId: entry.id,
          direction,
          operation: edit.type,
          recordType: table === 'descriptions' ? String(row?.data.type ?? '') : null,
          member: index + 1,
          members: edits.length,
          rowKey: edit.rowKey,
          idField,
          id: typeof id === 'string' ? id : null,
          isComment: row ? String(row.isComment) : null,
          sourceRowIndex: document.baselineRowOrder.indexOf(edit.rowKey),
          rowIndex: 'rowIndex' in edit ? edit.rowIndex : document.rowOrder.indexOf(edit.rowKey),
          column: 'col' in edit ? edit.col : null,
          previousId: ids[0],
          nextId: ids[1],
          previousIndex: 'previousIndex' in edit ? (direction === 'undo' ? edit.nextIndex : edit.previousIndex) : null,
          nextIndex: 'nextIndex' in edit ? (direction === 'undo' ? edit.previousIndex : edit.nextIndex) : null,
        }),
      });
    }
  }

  function getStack(modRoot: string, table: CsvTableKey) {
    return stateMap.get(modRoot)?.documents[table].history;
  }

  function pushCsvTableEdit(modRoot: string, table: CsvTableKey, edit: CsvDraftEdit, label: string) {
    if (!modRoot) return;
    const stack = getStack(modRoot, table)!;
    const entry = { id: nextUndoStackId(stack, 'csv_edit'), timestamp: Date.now(), edit, label };
    pushUndoEntry(stack, entry);
    recordCsvEdit(modRoot, table, entry, 'edit');
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
    if (!tableState || !applyCsvDraftEdit(tableState.documents[table], entry.edit, 'undo')) return null;
    reconcileSelection(tableState, table, entry.edit);
    popUndoEntry(stack);
    pushRedoEntry(stack, entry);
    recordCsvEdit(modRoot, table, entry, 'undo');
    return entry.label;
  }

  function redoCsvTable(modRoot: string, table: CsvTableKey, tableState: CsvModState | undefined): string | null {
    const stack = getStack(modRoot, table);
    const entry = stack ? peekRedoEntry(stack) : undefined;
    if (!stack || !entry) return null;
    if (!tableState || !applyCsvDraftEdit(tableState.documents[table], entry.edit, 'redo')) return null;
    reconcileSelection(tableState, table, entry.edit);
    popRedoEntry(stack);
    pushUndoEntry(stack, entry, { clearRedo: false });
    recordCsvEdit(modRoot, table, entry, 'redo');
    return entry.label;
  }

  function reconcileSelection(state: CsvModState, table: CsvTableKey, edit: CsvDraftEdit) {
    if (state.currentTab !== table) return;
    if (edit.type === 'row-moved') state.selectedRowKey = edit.rowKey;
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
      const edits = entry.edit.type === 'batch' ? [entry.edit, ...entry.edit.edits] : [entry.edit];
      for (const edit of edits) {
        edit.rowKey = mapped.get(edit.rowKey) ?? edit.rowKey;
        if (edit.type === 'row-created' || edit.type === 'row-deleted') edit.row.rowKey = edit.rowKey;
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

  function getTableProblems(target: CsvTableTarget) {
    const document = stateMap.get(target.modRoot)!.documents[target.table];
    return (document.problems ??= markRaw(createEditorProblems(document.inputs, () => csvTableIssues(document))));
  }
  function acceptTableValidation(target: CsvTableTarget, key: string, context: DeepReadonly<CsvValidationContext>) {
    const document = stateMap.get(target.modRoot)!.documents[target.table];
    document.validationKey = key;
    document.validationContext = markRaw(cloneQuerySnapshot<CsvValidationContext>(context));
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
    applyTableSummaries(state, target.manifest.tableSummaries);
    stateMap.set(target.modRoot, state);
  }

  function acceptTableSummaries(modRoot: string, summaries: ProjectManifest['tableSummaries']) {
    const state = stateMap.get(modRoot);
    if (state) applyTableSummaries(state, summaries);
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
    getTableEditor,
    getTableProblems,
    acceptTableValidation,
    bindSaveActions,
    getCsvModState,

    isTableLocked,
    hasTableDirtyChanges,
    canSaveTable,

    getTableInputs,
    setActiveCell,
    updateCellValue,
    updateRange,
    addNewRow,
    deleteSelectedRow,
    moveRows,
    copyRows,
    insertRows,
    deleteRows,
    selectRowByKey,
    setSearchText,
    setSearchField,
    switchTab,
    lockTable,
    releaseTableLock,

    setSaving,
    isTableSaving,
    applySavedRowKeyMap,
    captureSaveHistory,
    commitSaveHistory,
    clearCsvTableHistory,
    setHistoryLimit,

    initializeModTables,
    acceptTableSummaries,
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
