<template>
  <tbody>
    <tr v-if="beforeHeight > 0" class="csv-grid-spacer-row csv-grid-row" :style="{ height: `${beforeHeight}px` }">
      <td class="csv-grid-cell" :colspan="columns.length + 1"></td>
    </tr>
    <template v-for="row in visibleRows" :key="row.kind === 'row' ? rowRenderKey(row) : row.slotKey">
      <CsvGridRow
        v-if="row.kind === 'row'"
        :active-cell="activeCell"
        :columns="columns"
        :is-dirty="isDirty"
        :row="row"
        :selected="row.rowKey === selectedRowKey"
        :source-index="sourceIndex"
        :reorder-disabled-reason="reorderDisabledReason"
        :insertion="insertion"
        @start-row-drag="(rowKey, event) => $emit('start-row-drag', rowKey, event)"
        @activate-cell="forwardActivateCell"
        @close-active-cell="$emit('close-active-cell')"
        @select-row="selectRow"
      />
      <tr v-else class="csv-grid-placeholder-row csv-grid-row">
        <td class="csv-grid-cell" :colspan="columns.length + 1"></td>
      </tr>
    </template>
    <tr v-if="afterHeight > 0" class="csv-grid-spacer-row csv-grid-row" :style="{ height: `${afterHeight}px` }">
      <td class="csv-grid-cell" :colspan="columns.length + 1"></td>
    </tr>
  </tbody>
</template>
<script setup lang="ts">
import type { CsvGridRowSlot, CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import CsvGridRow from '@/app/components/tables/CsvGridRow.vue';
import type { RowData } from '@/shared/types';

const renderKeys = new WeakMap<RowData, string>();
function rowRenderKey(row: CsvRowRecord) {
  let key = renderKeys.get(row.data);
  if (key === undefined) {
    key = row.rowKey;
    renderKeys.set(row.data, key);
  }
  return key;
}

defineProps<{
  reorderDisabledReason?: string;
  insertion?: { rowKey: string; after: boolean } | null;
  activeCell: { columnKey: string; rowKey: string } | null;
  afterHeight: number;
  beforeHeight: number;
  columns: CsvGridColumn[];
  isDirty: (rowKey: string, column: string) => boolean;
  selectedRowKey: string | null;
  sourceIndex: CsvSourceIndex;
  visibleRows: CsvGridRowSlot[];
}>();

const emit = defineEmits<{
  'start-row-drag': [rowKey: string, event: PointerEvent];
  'activate-cell': [row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent];
  'close-active-cell': [];
  'select-row': [rowKey: string, event: MouseEvent];
}>();

function selectRow(rowKey: string, event: MouseEvent) {
  emit('select-row', rowKey, event);
}

function forwardActivateCell(row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent) {
  emit('activate-cell', row, column, event);
}
</script>
