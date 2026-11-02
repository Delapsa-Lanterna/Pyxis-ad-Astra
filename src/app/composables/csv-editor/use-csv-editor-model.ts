import { computed, reactive, type Ref } from 'vue';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { csvColumnsForTable } from '@/domain/csv-editor/csv-column-schema';
import { csvDirtyCells } from '@/domain/csv-editor/csv-dirty';
import { DEFAULT_CSV_SEARCH_FIELD } from '@/domain/csv-editor/csv-search';
import { csvVisibleRowKeys, hasCsvRowOrderChanges } from '@/domain/csv-editor/csv-table-draft';
import { isLoadedCsvTableRow } from '@/domain/csv-editor/csv-table-rows';
import type { CsvTableTarget } from '@/shared/types';
export function useCsvEditorModel(target: Readonly<Ref<CsvTableTarget | null>>) {
  const tables = useCsvEditorStore();
  const modState = computed(() => {
    const current = target.value,
      runtime = current ? tables.getCsvModState(current.modRoot) : undefined;
    return runtime?.sessionId === current?.sessionId ? runtime : undefined;
  });
  const document = computed(() => (modState.value ? tables.getTableEditor(target.value!) : null));
  const currentTab = computed(() => target.value?.table ?? 'ships');
  const saving = computed(() => modState.value?.documents[currentTab.value].saving ?? false);
  const currentTableLocked = computed(() =>
    target.value?.modRoot ? tables.isTableLocked(target.value?.modRoot, currentTab.value) : false,
  );
  const searchField = computed(() => modState.value?.searchField ?? DEFAULT_CSV_SEARCH_FIELD);
  const currentHeader = computed(() => modState.value?.documents[currentTab.value].header ?? []);
  const searchText = computed(() => modState.value?.searchText ?? '');
  const selectedRowKey = computed(() => modState.value?.selectedRowKey ?? null);
  const editing = computed(() => modState.value?.editing ?? null);
  const rows = computed(() => {
    const current = modState.value;
    return current
      ? csvVisibleRowKeys(current.documents[currentTab.value]).map((key) => current.documents[currentTab.value].rows[key] ?? null)
      : [];
  });
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
    const state = modState.value;
    return state ? csvVisibleRowKeys(state.documents[currentTab.value]) : [];
  });
  const rowsByKey = computed(() => modState.value?.documents[currentTab.value].rows ?? {});
  const totalRowCount = computed(() => modState.value?.documents[currentTab.value].totalRowCount ?? 0);
  const filteredRowCount = computed(() => modState.value?.documents[currentTab.value].filteredRowCount ?? 0);
  const hasCurrentTableFilter = computed(
    () => Boolean(searchText.value.trim()) || filteredRowCount.value !== (modState.value?.documents[currentTab.value].totalRowCount ?? 0),
  );
  const selectedRowRecord = computed(() =>
    selectedRowKey.value ? modState.value?.documents[currentTab.value].rows[selectedRowKey.value] : undefined,
  );
  const selectedRow = computed(() => selectedRowRecord.value?.data);
  const tableInfo = computed(() => {
    const state = modState.value;
    if (!state) return '显示 0 / 0 行';
    return `显示 ${state.documents[currentTab.value].filteredRowCount} / ${state.documents[currentTab.value].totalRowCount} 行`;
  });
  const hasCurrentRowOrderChanges = computed(() => {
    const state = modState.value;
    return state ? hasCsvRowOrderChanges(state.documents[currentTab.value]) : false;
  });
  const hasCurrentTableChanges = computed(() => {
    const state = modState.value;
    if (!state) return false;
    return tables.hasTableDirtyChanges(target.value!);
  });
  const hasCurrentTableExternalUpdate = computed(() => {
    const state = modState.value;
    return state ? state.documents[currentTab.value].externalUpdatePending : false;
  });
  const isDirty = computed(() => {
    const table = modState.value?.documents[currentTab.value].dirty ?? {};
    return (rowKey: string, col: string) => csvDirtyCells(table[rowKey])?.[col] !== undefined;
  });

  const canSaveCurrentTable = computed(() => Boolean(modState.value && tables.canSaveTable(target.value!)));
  return {
    target,
    state: modState,
    document,
    view: reactive({
      currentTab,
      saving,
      currentTableLocked,
      searchField,
      currentHeader,
      searchText,
      selectedRowKey,
      editing,
      rows,
      visibleColumns,
      rowKeys,
      rowsByKey,
      totalRowCount,
      filteredRowCount,
      hasCurrentTableFilter,
      selectedRowRecord,
      selectedRow,
      tableInfo,
      hasCurrentRowOrderChanges,
      hasCurrentTableChanges,
      hasCurrentTableExternalUpdate,
      isDirty,
      canSaveCurrentTable,
    }),
  };
}
export type CsvEditorModel = ReturnType<typeof useCsvEditorModel>;
