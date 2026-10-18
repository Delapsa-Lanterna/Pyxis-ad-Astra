<template>
  <Teleport v-if="target && row && column && anchorElement" :to="anchorElement">
    <CsvGridCellEditor
      :anchor-element="anchorElement"
      :initial-anchor="initialAnchor"
      :column="column"
      :row="row"
      :source-index="sourceIndex"
      @close="$emit('close')"
    />
  </Teleport>
</template>

<script setup lang="ts">
import type { CsvCellTarget, CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import type { CsvFloatingAnchor } from '@/app/composables/tables/use-csv-floating-panel';
import CsvGridCellEditor from './CsvGridCellEditor.vue';

defineProps<{
  target: CsvCellTarget | null;
  row: CsvRowRecord | null;
  column: CsvGridColumn | null;
  sourceIndex: CsvSourceIndex;
  anchorElement: HTMLElement | null;
  initialAnchor?: CsvFloatingAnchor | null;
}>();

defineEmits<{
  close: [];
}>();
</script>
