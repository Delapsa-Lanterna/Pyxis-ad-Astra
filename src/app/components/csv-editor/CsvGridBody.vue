<template>
  <div class="csv-grid-body" role="rowgroup">
    <CsvGridRow
      v-for="entry in items"
      :key="entry.key"
      :row="entry.item"
      :activity="entry"
      :columns="columns"
      :source-index="sourceIndex"
      :selected="selectedRowKey === entry.item.rowKey"
      :row-selected="selectedRows?.includes(entry.item.rowKey) ?? false"
      :selected-column="selectedRowKey === entry.item.rowKey ? selectedColumn : null"
      :range-columns="rangeForRow?.(entry.index) ?? ''"
      :is-dirty="isDirty"
      :reorder-disabled-reason="reorderDisabledReason"
      @start-row-drag="(key, event) => $emit('start-row-drag', key, event)"
      @activate-cell="(row, column, event) => $emit('activate-cell', row, column, event)"
      @select-row="(key) => $emit('select-row', key)"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn, CsvRenderColumn } from '@/domain/csv-editor/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/schema/csv-source-options';
import type { RetainedListEntry } from '@/shared/runtime/retained-list';
import CsvGridRow from './CsvGridRow.vue';
const props = defineProps<{
  entries: RetainedListEntry<CsvRowRecord>[];
  columns: CsvRenderColumn[];
  sourceIndex: CsvSourceIndex;
  selectedRowKey: string | null;
  selectedRows?: string[];
  selectedColumn?: string | null;
  rangeForRow?: (index: number) => string;
  isDirty: (rowKey: string, column: string) => boolean;
  reorderDisabledReason?: string;
}>();

const items = computed(() => props.entries.filter((entry) => entry.kind === 'item'));
defineEmits<{
  'start-row-drag': [key: string, event: PointerEvent];
  'activate-cell': [row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent];
  'select-row': [key: string];
}>();
</script>
