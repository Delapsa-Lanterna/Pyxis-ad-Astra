<template>
  <div v-if="view.currentTableLocked" class="table-external-update-note ui-control-between ui-text-note">
    <span>规格身份正在交接，本表稍后恢复编辑。</span>
  </div>
  <div v-if="view.hasCurrentTableExternalUpdate" class="table-external-update-note ui-control-between ui-text-note">
    <span>当前 CSV 文件已在外部更新，未保存修改已保留。</span>
    <n-button size="tiny" secondary type="warning" @click="csvTable.loadExternalTableUpdate">载入外部版本</n-button>
  </div>
  <CsvGrid
    ref="grid"
    :inert="view.currentTableLocked"
    :editing="view.editing"
    :is-dirty="view.isDirty"
    :model="effectiveGridModel"
    :selected-row-key="view.selectedRowKey"
    :reorder-disabled-reason="csvTable.reorderDisabledReason.value"
    :reorder-context="csvTable.reorderContext.value"
    @request-window="csvTable.loadTableWindow"
    @resize-column="csvTable.setColumnWidth"
    @select-row="tables.selectRowByKey(target, $event)"
    @undo="$emit('undo')"
    @redo="$emit('redo')"
  />
  <div v-if="view.filteredRowCount > 0 && view.visibleColumns.length === 0" class="table-empty-note ui-text-small">
    当前表有 {{ view.filteredRowCount }} 行，但没有可显示列。请检查 CSV 表头。
  </div>
  <div v-else-if="view.totalRowCount > 0 && view.filteredRowCount === 0" class="table-empty-note ui-text-small">
    当前表有 {{ view.totalRowCount }} 行，但被搜索隐藏。
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, useTemplateRef } from 'vue';
import CsvGrid from '@/app/components/csv-editor/CsvGrid.vue';
import type { CsvTableViewModel } from '@/app/composables/csv-editor/use-csv-table-view-model';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { provideCsvTableInputs } from '@/app/composables/csv-editor/use-csv-table-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';

const props = defineProps<{ csvTable: CsvTableViewModel }>();
const tables = useCsvEditorStore();
const view = props.csvTable.model.view;
defineEmits<{ undo: []; redo: [] }>();
const target = props.csvTable.target.value!;
const grid = useTemplateRef<InstanceType<typeof CsvGrid>>('grid');
defineExpose({ deleteRows: () => grid.value!.deleteRows() });
const inputs = tables.getTableInputs(target.modRoot, target.table);
provideCsvTableInputs({
  target,
  inputs,
  activate: (cell) => tables.setActiveCell(cell, target.modRoot),
  update: tables.updateCellValue,
  range: {
    load: props.csvTable.ensureTableRows,
    update: (keys, columns, values) => tables.updateRange(target, keys, columns, values),
    revision: () => JSON.stringify([props.csvTable.reorderContext.value, view.searchText, view.searchField]),
    disabled: () => view.currentTableLocked || view.saving || props.csvTable.searchPending.value,
    move: (keys, boundary) => tables.moveRows(target, keys, boundary),
    copy: (keys, boundary) => tables.copyRows(target, keys, boundary),
    remove: (keys) => tables.deleteRows(target, keys),
    insert: (columns, values, boundary) =>
      tables.insertRows(
        target,
        values.map((values) => {
          const data = Object.fromEntries(view.currentHeader.map((key) => [key, '']));
          columns.forEach((column, index) => {
            data[column] = values[index] ?? '';
          });
          return { rowKey: '', data, isComment: (data[view.currentHeader[0]!] ?? '').startsWith('#') };
        }),
        boundary,
      ),
    position: (key, after = false) => tables.getCsvModState(target.modRoot)!.documents[target.table].rowOrder.indexOf(key) + Number(after),
  },
});
useInputEditMode(inputs);
onScopeDispose(() => tables.setActiveCell(null, target.modRoot));
const effectiveGridModel = computed(() => ({
  ...props.csvTable.gridModel.value,
  columns: props.csvTable.effectiveColumns.value,
  totalWidthPx: props.csvTable.effectiveTotalWidthPx.value,
}));
</script>
