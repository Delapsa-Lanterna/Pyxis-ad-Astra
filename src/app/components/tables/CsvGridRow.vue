<template>
  <tr
    class="csv-grid-row"
    :data-row-key="row.rowKey"
    :class="{
      selected,
      'csv-grid-drop-before': insertion?.rowKey === row.rowKey && !insertion.after,
      'csv-grid-drop-after': insertion?.rowKey === row.rowKey && insertion.after,
    }"
    @click="$emit('select-row', row.rowKey, $event)"
  >
    <th class="csv-grid-cell csv-row-handle-cell" scope="row" :title="reorderDisabledReason || '拖动调整行序'">
      <button
        class="csv-row-handle ui-control-reset"
        type="button"
        :disabled="Boolean(reorderDisabledReason)"
        aria-label="拖动调整行序"
        @pointerdown.prevent.stop="$emit('start-row-drag', row.rowKey, $event)"
        @click.stop="$emit('select-row', row.rowKey, $event)"
      >
        <svg class="csv-row-handle-icon" viewBox="0 0 12 12" aria-hidden="true">
          <circle v-for="point in 6" :key="point" :cx="point % 2 ? 4 : 8" :cy="Math.floor((point - 1) / 2) * 4 + 2" r="0.8" />
        </svg>
      </button>
    </th>
    <CsvGridCell
      v-for="column in columns"
      :key="column.key"
      :active="activeCell?.rowKey === row.rowKey && activeCell?.columnKey === column.key"
      :column="column"
      :dirty="isDirty(row.rowKey, column.key)"
      :row="row"
      :source-index="sourceIndex"
      @activate-cell="forwardActivateCell"
      @close-active-cell="$emit('close-active-cell')"
    />
  </tr>
</template>
<script setup lang="ts">
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import CsvGridCell from '@/app/components/tables/CsvGridCell.vue';

defineProps<{
  reorderDisabledReason?: string;
  insertion?: { rowKey: string; after: boolean } | null;
  activeCell: { columnKey: string; rowKey: string } | null;
  columns: CsvGridColumn[];
  isDirty: (rowKey: string, column: string) => boolean;
  row: CsvRowRecord;
  selected: boolean;
  sourceIndex: CsvSourceIndex;
}>();

const emit = defineEmits<{
  'start-row-drag': [rowKey: string, event: PointerEvent];
  'activate-cell': [row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent];
  'close-active-cell': [];
  'select-row': [rowKey: string, event: MouseEvent];
}>();

function forwardActivateCell(row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent) {
  emit('activate-cell', row, column, event);
}
</script>
