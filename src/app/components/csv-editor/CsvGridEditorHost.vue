<template>
  <Teleport v-if="target && row && column && anchorElement" :to="anchorElement">
    <CsvGridCellEditor
      ref="editor"
      :anchor-element="anchorElement"
      :initial-anchor="initialAnchor"
      :column="column"
      :row="row"
      :source-index="sourceIndex"
      :edit="edit"
      @close="$emit('close')"
    />
  </Teleport>
</template>

<script setup lang="ts">
import type { CsvCellTarget, CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/csv-editor/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/schema/csv-source-options';
import type { CsvFloatingAnchor } from '@/app/composables/csv-editor/use-csv-floating-panel';
import CsvGridCellEditor from './CsvGridCellEditor.vue';
import type { CsvCellEdit } from '@/app/composables/csv-editor/csv-cell-edit';
import { useTemplateRef } from 'vue';
const editor = useTemplateRef<InstanceType<typeof CsvGridCellEditor>>('editor');
defineExpose({ capture: () => editor.value?.capture() });

defineProps<{
  target: CsvCellTarget | null;
  row: CsvRowRecord | null;
  column: CsvGridColumn | null;
  sourceIndex: CsvSourceIndex;
  anchorElement: HTMLElement | null;
  initialAnchor?: CsvFloatingAnchor | null;
  edit?: CsvCellEdit;
}>();

defineEmits<{
  close: [];
}>();
</script>
