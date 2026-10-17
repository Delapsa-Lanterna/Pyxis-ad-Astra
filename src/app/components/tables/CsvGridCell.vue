<template>
  <td
    class="csv-grid-cell"
    :class="[column.className, { dirty, 'csv-cell-active': active }]"
    :data-column-key="column.key"
    @click.stop="$emit('activate-cell', row, column, $event)"
  >
    <div
      ref="frameElement"
      class="csv-cell-frame ui-text-body ui-text-normal ui-layout-row ui-layout-center ui-layout-clip ui-layout-stretch ui-content-surface-muted"
      :class="[`csv-cell-frame-${column.schema?.control ?? 'text'}`, { 'csv-cell-frame-active': active }]"
    >
      <CsvGridCellEditor
        v-if="active"
        :anchor-element="frameElement"
        :column="column"
        :row="row"
        :source-index="sourceIndex"
        @close="$emit('close-active-cell')"
      />
      <CsvGridStaticCell v-else :column="column" :row="row" :source-index="sourceIndex" />
    </div>
  </td>
</template>
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import CsvGridCellEditor from '@/app/components/tables/CsvGridCellEditor.vue';
import CsvGridStaticCell from '@/app/components/tables/CsvGridStaticCell.vue';

defineProps<{
  active: boolean;
  column: CsvGridColumn;
  dirty: boolean;
  row: CsvRowRecord;
  sourceIndex: CsvSourceIndex;
}>();

const frameElement = useTemplateRef<HTMLElement>('frameElement');

defineEmits<{
  'activate-cell': [row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent];
  'close-active-cell': [];
}>();
</script>
