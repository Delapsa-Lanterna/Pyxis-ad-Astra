import { csvDraftSearchKeys } from '@/domain/csv-editor/csv-search';
import { hasSourceInvalidation, querySourceOptionCatalog } from '@/services/source-catalog.service';
import { hasTableInvalidation, queryTableRowPreviewDataUrl, queryTableIndex, queryTableRows } from '@/services/csv-table.service';
import { relativePathFromRoot } from '@/shared/lib/paths';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { refreshProjectSourcePaths, observeSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { parseCsvFieldSource, CONFIG_FIELD_SOURCES, isConfigFieldSource } from '@/domain/schema/schema-source-definitions';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import type { CsvEditorHost } from './csv-editor-context';
import type { CsvEditorModel } from './use-csv-editor-model';
import { createCsvGridColumns } from '@/domain/csv-editor/csv-grid-model';
import { csvColumnSchemaFor } from '@/domain/csv-editor/csv-column-schema';
import { mapSourceGroupsToSelectOptions, type SelectOption } from '@/domain/field-editor/field-options';
import { stableStringify, stableDeepEqual } from '@/shared/lib/stable-compare';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

import { hasResourceInvalidation } from '@/services/resource-media.service';
import type { FieldProblem, CsvRowPreviewTarget, ResourceRef, CsvSearchField, CsvDraftRow, SaveAcceptanceTask } from '@/shared/types';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { queryCsvValidation } from '@/services/csv-table.service';
import { csvValidationRows } from '@/domain/csv-editor/csv-validation';
import { csvValidationRequest, hasCsvValidationInvalidation } from '@/domain/csv-editor/csv-rule-context';
import { currentWindowLabel } from '@/windows/current.window';

export function useCsvTableViewModel(model: CsvEditorModel, host: CsvEditorHost) {
  const tables = useCsvEditorStore();
  const project = useProjectStore();
  const view = model.view;
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  let readFailed = false;
  let validationFailed = false;
  let validationPending: { key: string; work: Promise<boolean> } | null = null;
  let pendingRows = new Map<string, Promise<void>>();
  const rowQueue: Array<{ run: () => Promise<void>; cancel: () => void }> = [];
  let rowReads = 0;
  let lastRange = { start: 0, count: 240 };
  const widthSample = ref<CsvDraftRow[]>([]);
  const loadedSourceOptions = ref(new Map<string, SelectOption[]>());
  const searchPending = ref(false),
    windowReady = ref(false);
  const reorderDisabledReason = computed(() =>
    view.hasCurrentTableFilter
      ? '清空搜索和筛选后可调整行序'
      : view.currentTableLocked
        ? '身份交接期间无法调整行序'
        : searchPending.value || !windowReady.value
          ? '数据准备完成后可调整行序'
          : '',
  );
  const reorderContext = computed(() =>
    JSON.stringify([targetKey.value, tables.getCsvModState(target.value!.modRoot)?.documents[view.currentTab].baseVersions]),
  );
  let disposed = false;
  let refreshAfterSave = false;
  let searchRevision = 0;
  const target = model.target;
  const targetKey = computed(() => (target.value ? JSON.stringify(target.value) : ''));
  const validationRequest = computed(() => {
    const current = target.value,
      document = current && model.state.value?.documents[current.table];
    return document?.validationRows ? csvValidationRequest(current!.table, csvValidationRows(document)) : null;
  });
  watch(
    () => JSON.stringify([targetKey.value, validationRequest.value]),
    () => {
      if (!view.saving) void loadValidation();
    },
  );
  async function loadValidation(required = false) {
    const captured = target.value,
      request = validationRequest.value;
    if (!captured || !request) return;
    const key = JSON.stringify(request),
      state = tables.getCsvModState(captured.modRoot)!;
    const document = state.documents[captured.table];
    if (!required && document.validationKey === key && document.validationContext) return;
    if (validationPending?.key === key) {
      await validationPending.work;
      return;
    }
    const work = reads.consume(
      'validation',
      { ...captured, request },
      (signal) => queryCsvValidation(captured.sessionId, request, signal),
      {
        ready: (context) => {
          if (state === tables.getCsvModState(captured.modRoot)) {
            tables.acceptTableValidation(captured, key, context);
            if (validationFailed) tables.getTableProblems(captured).clearFailure();
            validationFailed = false;
          }
        },
        error: (error) => {
          if (state !== tables.getCsvModState(captured.modRoot)) return;
          validationFailed = true;
          tables.getTableProblems(captured).recordFailure(error);
          if (required) throw error;
          feedback.error(error, '读取 CSV 校验来源失败');
        },
      },
    );
    validationPending = { key, work };
    try {
      await work;
    } finally {
      if (validationPending?.work === work) validationPending = null;
    }
  }
  const columnWidthOverrides = host.columnWidths;
  watch(
    targetKey,
    () => {
      searchRevision++;
      if (host.entityLocation.value?.kind === 'ship') host.cancelEntityLocation(host.entityLocation.value);
    },
    { flush: 'sync' },
  );
  const { confirmDiscard } = useFieldInputActions(null);
  watch(
    () => view.selectedRowKey,
    () => {
      if (host.entityLocation.value?.kind === 'ship') {
        host.cancelEntityLocation(host.entityLocation.value);
        reads.revoke('consumer', 'location');
      }
    },
    { flush: 'sync' },
  );
  useContextMenuScope({
    identity: () => targetKey.value,
    canRefresh: () => Boolean(target.value) && !view.currentTableLocked,
    refresh: () => {
      const captured = target.value!;
      const tables = new Set([
        captured.table,
        ...[...visibleSourceIds()].flatMap((source) => {
          const parsed = parseCsvFieldSource(source);
          return parsed ? [parsed.table] : [];
        }),
      ]);
      const targets = project.tableWriteTargets.filter((target) => target.sessionId === captured.sessionId && tables.has(target.table));
      const configPaths = [...visibleSourceIds()].filter(isConfigFieldSource).map((source) => CONFIG_FIELD_SOURCES[source]);
      const coreSources = host.manifest.value!.coreAvailable
        ? [...targets.map((target) => relativePathFromRoot(captured.modRoot, target.path)), ...configPaths].map((relPath) => ({
            source: 'core' as const,
            relPath,
          }))
        : [];
      return refreshProjectSourcePaths(
        captured.sessionId,
        captured.modRoot,
        [...targets.map((target) => target.path), ...configPaths.map((path) => captured.modRoot + '/' + path)],
        [...loadedSourceResourceRefs(), ...coreSources],
      );
    },
  });

  async function commitTableInput() {
    const current = target.value;
    if (!current) return;
    const pending = tables.getTableInputs(current.modRoot, current.table).commit();
    return pending ? await pending : true;
  }

  async function setSearchText(text: string) {
    if (searchPending.value) return;
    const captured = target.value;
    const key = targetKey.value;
    const revision = searchRevision;
    const accepts = () => !disposed && key === targetKey.value && revision === searchRevision;
    searchPending.value = true;
    try {
      if (!captured || !(await commitTableInput()) || !accepts()) return;
      if (text === view.searchText && windowReady.value) await loadIndex(Boolean(text.trim()), 0);
      else if (accepts()) tables.setSearchText(captured, text);
    } catch (error) {
      feedback.error(error);
    } finally {
      searchPending.value = false;
    }
  }

  async function setSearchField(value: CsvSearchField) {
    if (searchPending.value) return;
    const captured = target.value;
    const key = targetKey.value;
    try {
      if (captured && (await commitTableInput()) && key === targetKey.value) tables.setSearchField(captured, value);
    } catch (error) {
      feedback.error(error);
    }
  }

  const columnModel = computed(() =>
    createCsvGridColumns(view.currentTab, view.visibleColumns, widthSample.value, loadedSourceOptions.value),
  );
  const sourceIndex = computed(() => columnModel.value.sourceIndex);
  const gridModel = computed(() => ({
    ...columnModel.value,
    rowKeys: view.rowKeys,
    rowsByKey: view.rowsByKey,
    sourceIndex: sourceIndex.value,
  }));

  const lockedColumnWidths = ref<Record<string, number>>({});

  const effectiveColumns = computed(() =>
    columnModel.value.columns.map((col) => ({
      ...col,
      widthPx: Object.hasOwn(columnWidthOverrides.value, col.key)
        ? columnWidthOverrides.value[col.key]!
        : Object.hasOwn(lockedColumnWidths.value, col.key)
          ? lockedColumnWidths.value[col.key]!
          : col.widthPx,
    })),
  );
  const effectiveTotalWidthPx = computed(() => effectiveColumns.value.reduce((sum, col) => sum + col.widthPx, 0));

  watch(
    targetKey,
    async () => {
      const captured = target.value,
        identity = targetKey.value;
      clearLocalQueryState();
      if (!captured) return;
      lockedColumnWidths.value = {};
      await initializeIndex();
      if (disposed || identity !== targetKey.value) return;
      lockColumnWidthsForLoadedModel();
    },
    { immediate: true },
  );
  watch(
    () => [view.searchText, view.searchField] as const,
    () => {
      if (windowReady.value) void loadIndex(Boolean(view.searchText.trim()), 0);
      else void initializeIndex();
    },
  );

  watch(
    () => stableStringify(columnModel.value.columns.map((column) => column.key)),
    () => {
      void reloadVisibleSourceOptions().then(lockColumnWidthsForLoadedModel);
    },
    { immediate: true },
  );

  function setColumnWidth(key: string, width: number) {
    const captured = target.value;
    if (captured) host.setColumnWidth(captured, key, Math.max(40, width));
  }

  const stopQueryInvalidation = observeSavedContent(
    (event) => {
      const captured = target.value;
      const update = sessionContentUpdate(event, captured?.sessionId);
      if (!captured || !update) return;
      const identity = targetKey.value;
      const state = tables.getCsvModState(captured.modRoot);
      const fromSave = event.reason !== 'refresh' && event.originWindowLabel === currentWindowLabel();
      const tasks: SaveAcceptanceTask[] = [];
      const csvPath = project.tableWriteTargets.find(
        (target) => target.sessionId === captured.sessionId && target.table === captured.table,
      )!.path;
      const ownCsvOnly =
        update.invalidation.resources.length > 0 &&
        update.invalidation.resources.every(
          ({ source, relPath }) => source === 'mod' && relPath === relativePathFromRoot(captured.modRoot, csvPath),
        );
      const sourceValues = (source: string) => {
        const parsed = parseCsvFieldSource(source);
        if (!ownCsvOnly || captured.table === 'specialItems' || !parsed || parsed.table !== captured.table || parsed.column === 'id')
          return null;
        return JSON.stringify(state?.documents[captured.table].validationRows?.map((row) => [row.isComment, row.data[parsed.column]]));
      };
      const beforeSources = new Map([...visibleSourceIds()].map((source) => [source, sourceValues(source)]));
      if (hasTableInvalidation(update.invalidation, 'csv-table-window', view.currentTab)) {
        tasks.push(async () => {
          if (disposed || identity !== targetKey.value || state !== tables.getCsvModState(captured.modRoot)) return;
          reads.revoke();
          clearRowQueue();
          const filtered = Boolean(view.searchText.trim());
          await reads.consume(
            'index',
            { ...captured, requestId: event.result.requestId },
            (signal) =>
              queryTableIndex(
                captured.sessionId,
                captured.table,
                lastRange.start === 0 ? lastRange.count : 0,
                view.searchText || null,
                view.searchField,
                signal,
              ),
            {
              ready: (index) => {
                if (identity !== targetKey.value || state !== tables.getCsvModState(captured.modRoot)) return;
                if (fromSave) tables.acceptSavedTableIndex(captured, index, filtered);
                else tables.applyTableIndex(captured, index, filtered);
                refreshAfterSave = false;
                windowReady.value = true;
                lockColumnWidthsForLoadedModel();
              },
              error: (error) => {
                if (identity === targetKey.value && state === tables.getCsvModState(captured.modRoot)) throw error;
              },
            },
          );
          if (lastRange.start > 0) await loadTableWindow(lastRange.start, lastRange.count);
        });
      }
      if (
        [...visibleSourceIds()].some((source) => hasSourceInvalidation(update.invalidation, source)) ||
        hasResourceInvalidation(update.invalidation, loadedSourceResourceRefs())
      )
        tasks.push(() =>
          reloadVisibleSourceOptions(
            true,
            [...visibleSourceIds()].filter((source) => {
              const before = beforeSources.get(source);
              return !before || state?.documents[captured.table].externalUpdatePending || before !== sourceValues(source);
            }),
          ),
        );
      const request = validationRequest.value;
      if (
        request &&
        (!state?.documents[captured.table].validationContext ||
          hasCsvValidationInvalidation(update.invalidation, request, (source) => hasSourceInvalidation(update.invalidation, source)))
      )
        tasks.push(() => {
          reads.revoke('project', 'validation');
          validationPending = null;
          return loadValidation(true);
        });
      return tasks;
    },
    (sessionId) => {
      if (sessionId === target.value?.sessionId) reads.revoke('session');
    },
  );

  watch(
    () => view.saving || view.currentTableLocked,
    (saving) => {
      clearRowQueue();
      if (saving) {
        reads.revoke();
        refreshAfterSave = true;
        return;
      }
      if (!disposed && refreshAfterSave) {
        refreshAfterSave = false;
        if (windowReady.value) void loadTableWindow(lastRange.start, lastRange.count);
        else void loadIndex(false, 240);
      }
    },
    { flush: 'sync' },
  );
  onUnmounted(() => {
    disposed = true;
    clearRowQueue();
    lastRange = { start: 0, count: 240 };
    stopQueryInvalidation();
  });

  function clearLocalQueryState() {
    windowReady.value = false;
    reads.revoke();
    clearRowQueue();
    lastRange = { start: 0, count: 240 };
    loadedSourceOptions.value = new Map();
  }

  async function reloadCurrentTableWindow() {
    const captured = target.value!;
    const identity = targetKey.value;
    clearLocalQueryState();
    tables.discardTableDraftForReload(captured);
    await initializeIndex();
    if (disposed || identity !== targetKey.value) return;
    await reloadVisibleSourceOptions();
    lockColumnWidthsForLoadedModel();
  }

  function loadExternalTableUpdate() {
    const captured = targetKey.value;
    confirmDiscard(
      () => {
        if (disposed || targetKey.value !== captured) return;
        void reloadCurrentTableWindow();
      },
      tables.hasTableDirtyChanges(target.value!),
      () => targetKey.value,
      tables.getCsvModState(target.value!.modRoot)!.documents[target.value!.table].baseVersions.map((version) => version.path),
    );
  }

  function lockColumnWidthsForLoadedModel() {
    const model = columnModel.value;
    const hasLoadedRows = widthSample.value.length > 0;
    if (!hasLoadedRows && view.filteredRowCount > 0) return;
    if ([...visibleSourceIds()].some((source) => !loadedSourceOptions.value.has(source))) return;
    const hasLocked = Object.keys(lockedColumnWidths.value).length > 0;
    if (!hasLocked) {
      lockedColumnWidths.value = Object.fromEntries(model.columns.map((col) => [col.key, col.widthPx]));
      return;
    }
    const missing = model.columns.filter((col) => !Object.hasOwn(lockedColumnWidths.value, col.key));
    if (missing.length)
      lockedColumnWidths.value = { ...lockedColumnWidths.value, ...Object.fromEntries(missing.map((col) => [col.key, col.widthPx])) };
  }

  async function loadIndex(filtered: boolean, initialCount: number) {
    const captured = target.value;
    if (!captured) return;
    const state = tables.getCsvModState(captured.modRoot);
    if (!state) return;
    const generation = tables.tableReadGeneration(captured.modRoot, captured.table);
    const search = filtered ? view.searchText : null;
    const field = view.searchField;
    const document = state.documents[captured.table];
    const order = filtered ? [...document.rowOrder] : [];
    const drafts = filtered
      ? cloneQuerySnapshot<CsvDraftRow[]>(Object.keys(document.dirty).flatMap((key) => (document.rows[key] ? [document.rows[key]!] : [])))
      : [];
    let accepted = false;
    await reads.consume(
      'index',
      { ...captured, search, field, generation },
      (signal) => queryTableIndex(captured.sessionId, captured.table, initialCount, search, field, signal),
      {
        ready: (index) => {
          if (
            state !== tables.getCsvModState(captured.modRoot) ||
            generation !== tables.tableReadGeneration(captured.modRoot, captured.table) ||
            view.saving ||
            view.currentTableLocked
          )
            return;
          tables.applyTableIndex(
            captured,
            filtered ? { ...index, rowKeys: csvDraftSearchKeys(captured.table, order, drafts, index.rowKeys, search!, field) } : index,
            filtered,
          );
          if (initialCount) widthSample.value = cloneQuerySnapshot<CsvDraftRow[]>(index.rows.slice(0, 50));
          if (readFailed) tables.getTableProblems(captured).clearFailure();
          readFailed = false;
          windowReady.value = true;
          accepted = true;
          void locateRequestedRow();
          lockColumnWidthsForLoadedModel();
        },
        error: (error) => {
          if (
            state === tables.getCsvModState(captured.modRoot) &&
            generation === tables.tableReadGeneration(captured.modRoot, captured.table)
          ) {
            readFailed = true;
            tables.getTableProblems(captured).recordFailure(error);
            feedback.error(error, '加载表格索引失败');
          }
        },
      },
    );
    return accepted;
  }
  async function locateRequestedRow() {
    const location = host.entityLocation.value,
      captured = target.value;
    if (
      !location ||
      location.kind !== 'ship' ||
      captured?.table !== 'ships' ||
      captured.sessionId !== location.sessionId ||
      captured.modRoot !== location.modRoot ||
      !windowReady.value
    )
      return;
    if (!view.rowKeys.includes(location.rowKey!)) return;
    if (!view.rowsByKey[location.rowKey!]) {
      const accepted = await reads.consume(
        'location',
        location,
        (signal) => queryTableRows(captured.sessionId, 'ships', [location.rowKey!], signal),
        {
          ready: (rows) => {
            if (host.entityLocation.value === location && targetKey.value === JSON.stringify(captured))
              tables.applyTableRows(captured, rows);
          },
          error: (error) => {
            if (host.entityLocation.value === location && targetKey.value === JSON.stringify(captured))
              feedback.error(error, '加载定位船体失败');
          },
        },
      );
      if (!accepted || host.entityLocation.value !== location || targetKey.value !== JSON.stringify(captured)) return;
    }
    tables.selectRowByKey(captured, location.rowKey!);
    host.completeEntityLocation(location);
  }
  watch(
    () => host.entityLocation.value,
    () => {
      reads.revoke('consumer', 'location');
      void locateRequestedRow();
    },
    { flush: 'sync' },
  );
  async function initializeIndex() {
    const identity = targetKey.value;
    const hasSearch = target.value && tables.getCsvModState(target.value.modRoot)!.documents[target.value.table].queryRowKeys;
    const accepted = await loadIndex(false, 240);
    if (accepted && !disposed && identity === targetKey.value && view.searchText.trim() && !hasSearch) await loadIndex(true, 0);
  }
  function drainRows() {
    while (rowReads < 2 && rowQueue.length) {
      rowReads++;
      void rowQueue
        .shift()!
        .run()
        .finally(() => {
          rowReads--;
          drainRows();
        });
    }
  }
  function loadTableWindow(start: number, count: number): Promise<void> {
    lastRange = { start, count };
    return loadRows(view.rowKeys.slice(start, start + count));
  }
  function loadRows(requested: string[]): Promise<void> {
    const captured = target.value;
    if (!captured || !requested.length || !windowReady.value) return Promise.resolve();
    const state = tables.getCsvModState(captured.modRoot);
    if (!state) return Promise.resolve();
    const generation = tables.tableReadGeneration(captured.modRoot, captured.table);
    const missing = requested.filter((key) => !state.documents[captured.table].rows[key] && !pendingRows.has(key));
    const pending = pendingRows;
    const waits: Promise<void>[] = requested.flatMap((key) => (pending.has(key) ? [pending.get(key)!] : []));
    for (let offset = 0; offset < missing.length; offset += 160) {
      const keys = missing.slice(offset, offset + 160);
      const wait = new Promise<void>((resolve) => {
        rowQueue.push({
          cancel: resolve,
          run: async () => {
            try {
              await reads.consume(
                'rows:' + keys[0],
                { ...captured, generation, keys },
                (signal) => queryTableRows(captured.sessionId, captured.table, keys, signal),
                {
                  ready: (rows) => {
                    if (
                      state === tables.getCsvModState(captured.modRoot) &&
                      generation === tables.tableReadGeneration(captured.modRoot, captured.table) &&
                      !view.saving &&
                      !view.currentTableLocked
                    )
                      tables.applyTableRows(captured, rows);
                  },
                  error: (error) => {
                    if (
                      state === tables.getCsvModState(captured.modRoot) &&
                      generation === tables.tableReadGeneration(captured.modRoot, captured.table)
                    )
                      feedback.error(error, '加载表格内容失败');
                  },
                },
              );
            } finally {
              keys.forEach((key) => pending.delete(key));
              resolve();
            }
          },
        });
      });
      keys.forEach((key) => pending.set(key, wait));
      waits.push(wait);
    }
    drainRows();
    return Promise.all(waits).then(() => undefined);
  }

  async function ensureTableRows(keys: string[]) {
    const captured = target.value!;
    const state = tables.getCsvModState(captured.modRoot)!;
    const generation = tables.tableReadGeneration(captured.modRoot, captured.table);
    await loadRows(keys);
    return (
      state === tables.getCsvModState(captured.modRoot) &&
      generation === tables.tableReadGeneration(captured.modRoot, captured.table) &&
      keys.every((key) => Boolean(state.documents[captured.table].rows[key]))
    );
  }

  let problemRevision = 0;
  async function locateProblem(issue: FieldProblem) {
    const captured = target.value!,
      key = targetKey.value,
      revision = ++problemRevision;
    const document = model.state.value!.documents[captured.table],
      path = issue.path;
    const rowKey =
      document.rowOrder.find((row) => path === row || path.startsWith(row + '/')) ?? view.selectedRowKey ?? document.rowOrder[0];
    const current = () => !disposed && key === targetKey.value && revision === problemRevision && !view.currentTableLocked;
    try {
      if (!rowKey || !(await commitTableInput()) || !current()) return;
      if (!view.rowKeys.includes(rowKey)) await setSearchText('');
      if (!(await ensureTableRows([rowKey])) || !current()) return;
      return { rowKey, column: path.startsWith(rowKey + '/') ? path.slice(rowKey.length + 1) : undefined };
    } catch (error) {
      if (current()) feedback.error(error, '定位 CSV 提示失败');
    }
    return undefined;
  }

  function clearRowQueue() {
    for (const job of rowQueue) job.cancel();
    rowQueue.length = 0;
    pendingRows = new Map();
  }

  async function reloadVisibleSourceOptions(required = false, requested = [...visibleSourceIds()]) {
    const sessionId = target.value?.sessionId;
    if (!sessionId) return;
    const table = view.currentTab;
    const sources = requested;
    if (!sources.length) return;
    await reads.consume(
      'sources',
      { sessionId, table, sources },
      (signal) =>
        Promise.all(
          sources.map(async (source) => {
            const groups = await querySourceOptionCatalog(sessionId, source, signal);
            const options = mapSourceGroupsToSelectOptions(groups);
            return [source, options] as const;
          }),
        ),
      {
        ready: (entries) => {
          if (entries.some(([source, options]) => !stableDeepEqual(loadedSourceOptions.value.get(source), options)))
            loadedSourceOptions.value = new Map([...loadedSourceOptions.value, ...entries]);
          lockColumnWidthsForLoadedModel();
        },
        error: (error) => {
          feedback.error(error, '加载来源选项失败');
          if (required) throw error;
        },
      },
    );
  }

  function visibleSourceIds(): Set<string> {
    return new Set(view.visibleColumns.map((column) => csvColumnSchemaFor(view.currentTab, column)?.source).filter(isSourceId));
  }

  function loadedSourceResourceRefs(): ResourceRef[] {
    return [...loadedSourceOptions.value.values()].flatMap((options) =>
      options.flatMap((option) => [
        ...(option.resourceRef ? [option.resourceRef] : []),
        ...(option.children ?? []).flatMap((child) => (child.resourceRef ? [child.resourceRef] : [])),
      ]),
    );
  }

  function querySelectedRowPreview(target: CsvRowPreviewTarget, signal?: AbortSignal): Promise<string> {
    return queryTableRowPreviewDataUrl(target.sessionId, target.table, target.rowKey, signal);
  }

  return {
    model,
    target,
    targetKey,
    setSearchText,
    searchPending,
    reorderDisabledReason,
    reorderContext,
    setSearchField,
    gridModel,
    effectiveColumns,
    effectiveTotalWidthPx,
    sourceIndex,
    loadExternalTableUpdate,
    loadTableWindow,
    ensureTableRows,
    locateProblem,
    querySelectedRowPreview,
    setColumnWidth,
  };
}

export type CsvTableViewModel = ReturnType<typeof useCsvTableViewModel>;

function isSourceId(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
