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
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import type { RetainedListEntry } from '@/shared/runtime/retained-list';
import CsvGridRow from './CsvGridRow.vue';
const props = defineProps<{
  entries: RetainedListEntry<CsvRowRecord>[];
  columns: CsvGridColumn[];
  sourceIndex: CsvSourceIndex;
  selectedRowKey: string | null;
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
