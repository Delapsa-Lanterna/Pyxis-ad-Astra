import { hasSourceInvalidation, querySourceOptionCatalog } from '@/services/source-options.service';
import { hasTableInvalidation, queryTableRowPreviewDataUrl, queryTableIndex, queryTableRows } from '@/services/csv-table.service';
import { relativePathFromRoot } from '@/shared/lib/paths';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { refreshProjectSourcePaths } from '@/orchestrators/project-sync.orchestrator';
import { parseCsvSource } from '@/domain/schema/csv-source-options';
import { CONFIG_OPTION_SOURCES, isConfigSource } from '@/domain/schema/schema-sources';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { createCsvGridColumns } from '@/domain/csv-editor/csv-grid-model';
import { csvColumnSchemaFor } from '@/domain/csv-editor/csv-column-schema';
import { mapSourceGroupsToSelectOptions, type SelectOption } from '@/domain/schema/schema-options';
import { stableStringify } from '@/shared/lib/stable-compare';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-media.service';
import type { CsvRowPreviewTarget, ResourceRef, CsvSearchField } from '@/shared/types';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';

export function useCsvTableViewModel(saveBeforeSearch: () => Promise<boolean>) {
  const tables = useCsvEditorStore();
  const project = useProjectStore();
  const workspace = useWorkspaceStore();
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  let pendingRows = new Set<string>();
  const rowQueue: Array<{ run: () => Promise<void>; cancel: () => void }> = [];
  let rowReads = 0;
  let lastRange = { start: 0, count: 240 };
  const widthSample = ref<import('@/shared/types').CsvDraftRow[]>([]);
  const loadedSourceOptions = ref(new Map<string, SelectOption[]>());
  const columnWidthOverrides = ref<Record<string, number>>({});
  const searchPending = ref(false),
    windowReady = ref(false);
  const reorderDisabledReason = computed(() =>
    tables.hasCurrentTableFilter
      ? '清空搜索和筛选后可调整行序'
      : tables.currentTableLocked
        ? '身份交接期间无法调整行序'
        : searchPending.value || !windowReady.value
          ? '数据准备完成后可调整行序'
          : '',
  );
  const reorderContext = computed(() =>
    JSON.stringify([targetKey.value, tables.getCsvModState(tables.activeModRoot!)?.documents[tables.currentTab].baseVersions]),
  );
  let disposed = false;
  let refreshAfterSave = false;
  let searchRevision = 0;
  const target = computed(() =>
    workspace.activeSessionId && tables.activeModRoot
      ? {
          sessionId: workspace.activeSessionId,
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
        }
      : null,
  );
  const targetKey = computed(() => (target.value ? JSON.stringify(target.value) : ''));
  watch(
    targetKey,
    () => {
      searchRevision++;
    },
    { flush: 'sync' },
  );
  const { confirmDiscard } = useFieldInputActions(null);
  useContextMenuScope({
    identity: () => targetKey.value,
    canRefresh: () => Boolean(target.value) && !tables.currentTableLocked,
    refresh: () => {
      const captured = target.value!;
      const tables = new Set([
        captured.table,
        ...[...visibleSourceIds()].flatMap((source) => {
          const parsed = parseCsvSource(source);
          return parsed ? [parsed.table] : [];
        }),
      ]);
      const targets = project.tableWriteTargets.filter((target) => target.sessionId === captured.sessionId && tables.has(target.table));
      const configPaths = [...visibleSourceIds()].filter(isConfigSource).map((source) => CONFIG_OPTION_SOURCES[source]);
      const coreSources = workspace.activeManifest!.coreAvailable
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
      if (text.trim() && tables.hasCurrentRowOrderChanges) {
        const choice = await feedback.choose({
          title: '处理当前表未保存修改后搜索？',
          content: '此操作将处理当前表全部未保存修改，包括行序、字段内容、新建与删除。',
          choices: [
            { label: '保存并搜索', value: 'save', type: 'primary' },
            { label: '放弃修改并搜索', value: 'discard', type: 'warning' },
          ],
        });
        if (!accepts()) return;
        if (choice === 'save') {
          if (!(await saveBeforeSearch()) || !accepts() || tables.hasTableDirtyChanges(captured.table)) return;
        } else if (choice === 'discard') {
          tables.discardTableDraftForReload(captured);
          useCsvEditorStore().clearCsvTableHistory(captured.modRoot, captured.table);
        } else return;
      }
      if (accepts()) tables.setSearchText(captured, text);
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
    createCsvGridColumns(tables.currentTab, tables.visibleColumns, widthSample.value, loadedSourceOptions.value),
  );
  const sourceIndex = computed(() => columnModel.value.sourceIndex);
  const gridModel = computed(() => ({
    ...columnModel.value,
    rowKeys: tables.rowKeys,
    rowsByKey: tables.rowsByKey,
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
      columnWidthOverrides.value = workspace.getColumnWidths(captured.modRoot, captured.table) ?? {};
      await initializeIndex();
      if (disposed || identity !== targetKey.value) return;
      await reloadVisibleSourceOptions();
      lockColumnWidthsForLoadedModel();
    },
    { immediate: true },
  );
  watch(
    () => [tables.searchText, tables.searchField] as const,
    () => {
      if (windowReady.value) void loadIndex(Boolean(tables.searchText.trim()), 0);
      else void initializeIndex();
    },
  );

  watch(
    () => stableStringify(columnModel.value.columns.map((column) => column.key)),
    () => {
      lockColumnWidthsForLoadedModel();
    },
    { immediate: true },
  );

  function setColumnWidth(key: string, width: number) {
    columnWidthOverrides.value = { ...columnWidthOverrides.value, [key]: Math.max(40, width) };
    const modRoot = tables.activeModRoot;
    if (modRoot) {
      workspace.setColumnWidths(modRoot, tables.currentTab, columnWidthOverrides.value);
    }
  }

  const stopQueryInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== workspace.activeSessionId) return;
    if (event.scope === 'session') {
      reads.revoke();
      return;
    }
    const tableWindowChanged = hasTableInvalidation(event, 'csv-table-window', tables.currentTab);
    if (tableWindowChanged) {
      if (tables.saving || tables.currentTableLocked) {
        refreshAfterSave = true;
      } else if (
        tables.hasTableDirtyChanges(tables.currentTab) ||
        tables.getTableInputs(target.value!.modRoot, tables.currentTab).dirty.value
      ) {
        tables.markTableExternalUpdate(target.value!);
      } else {
        reads.schedule('window', () => {
          void reloadCurrentTableWindow();
        });
      }
    }
    const sources = visibleSourceIds();
    const optionsChanged = [...sources].some((source) => hasSourceInvalidation(event, source));
    if (!optionsChanged) return;
    reads.schedule('source', () => {
      void reloadVisibleSourceOptions();
    });
  });
  watch(
    () => tables.saving || tables.currentTableLocked,
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
  const stopResourceInvalidation = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== workspace.activeSessionId) return;
    if (!hasResourceInvalidation(event, loadedSourceResourceRefs())) return;
    reads.schedule('source', () => {
      void reloadVisibleSourceOptions();
    });
  });
  onUnmounted(() => {
    disposed = true;
    clearRowQueue();
    lastRange = { start: 0, count: 240 };
    stopQueryInvalidation();
    stopResourceInvalidation();
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
      tables.hasTableDirtyChanges(tables.currentTab),
      () => targetKey.value,
    );
  }

  function lockColumnWidthsForLoadedModel() {
    const model = columnModel.value;
    const hasLoadedRows = widthSample.value.length > 0;
    if (!hasLoadedRows && tables.filteredRowCount > 0) return;
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
    const search = filtered ? tables.searchText : null;
    const field = tables.searchField;
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
            tables.saving ||
            tables.currentTableLocked
          )
            return;
          tables.applyTableIndex(captured, index, filtered);
          if (initialCount) widthSample.value = cloneQuerySnapshot<import('@/shared/types').CsvDraftRow[]>(index.rows);
          windowReady.value = true;
          accepted = true;
          lockColumnWidthsForLoadedModel();
        },
        error: (error) => {
          if (
            state === tables.getCsvModState(captured.modRoot) &&
            generation === tables.tableReadGeneration(captured.modRoot, captured.table)
          )
            feedback.error(error, '加载表格索引失败');
        },
      },
    );
    return accepted;
  }
  async function initializeIndex() {
    const identity = targetKey.value;
    const accepted = await loadIndex(false, 240);
    if (accepted && !disposed && identity === targetKey.value && tables.searchText.trim()) await loadIndex(true, 0);
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
    const captured = target.value;
    if (!captured || count <= 0 || !windowReady.value) return Promise.resolve();
    const state = tables.getCsvModState(captured.modRoot);
    if (!state) return Promise.resolve();
    const generation = tables.tableReadGeneration(captured.modRoot, captured.table);
    const missing = tables.rowKeys
      .slice(start, start + count)
      .filter((key) => !state.documents[captured.table].rows[key] && !pendingRows.has(key));
    const pending = pendingRows;
    const waits: Promise<void>[] = [];
    for (let offset = 0; offset < missing.length; offset += 160) {
      const keys = missing.slice(offset, offset + 160);
      keys.forEach((key) => pending.add(key));
      waits.push(
        new Promise<void>((resolve) => {
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
                        !tables.saving &&
                        !tables.currentTableLocked
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
        }),
      );
    }
    drainRows();
    return Promise.all(waits).then(() => undefined);
  }

  function clearRowQueue() {
    for (const job of rowQueue) job.cancel();
    rowQueue.length = 0;
    pendingRows = new Set();
  }

  async function reloadVisibleSourceOptions() {
    const sessionId = workspace.activeSessionId;
    if (!sessionId) return;
    const table = tables.currentTab;
    const sources = [...visibleSourceIds()];
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
          loadedSourceOptions.value = new Map(entries);
          lockColumnWidthsForLoadedModel();
        },
        error: (error) => feedback.error(error, '加载来源选项失败'),
      },
    );
  }

  function visibleSourceIds(): Set<string> {
    return new Set(tables.visibleColumns.map((column) => csvColumnSchemaFor(tables.currentTab, column)?.source).filter(isSourceId));
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
    tables,
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
    querySelectedRowPreview,
    setColumnWidth,
  };
}

export type CsvTableViewModel = ReturnType<typeof useCsvTableViewModel>;

function isSourceId(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
