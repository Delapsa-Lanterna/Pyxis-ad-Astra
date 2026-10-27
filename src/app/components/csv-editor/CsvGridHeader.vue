<template>
  <div class="csv-grid-header csv-grid-row" role="row">
    <div class="csv-header-cell csv-row-handle-cell" role="columnheader" aria-label="行排序"></div>
    <div
      class="csv-header-cell"
      v-for="column in columns"
      :key="column.key"
      :class="column.className"
      :title="column.key"
      role="columnheader"
    >
      <span class="csv-th-label ui-layout-clip">{{ column.schema?.label ?? column.key }}</span>
      <span class="csv-th-resize" @mousedown.left.prevent="startResize($event, column)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue';
import type { CsvGridColumn } from '@/domain/csv-editor/csv-grid-model';

defineProps<{
  columns: CsvGridColumn[];
}>();

const emit = defineEmits<{
  'resize-column': [key: string, width: number];
}>();

let resizeState: { key: string; startX: number; startWidth: number } | null = null;

function startResize(event: MouseEvent, column: CsvGridColumn) {
  resizeState = { key: column.key, startX: event.clientX, startWidth: column.widthPx };
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
  document.body.classList.add('csv-column-resizing');
}

function onResizeMove(event: MouseEvent) {
  if (!resizeState) return;
  const delta = event.clientX - resizeState.startX;
  emit('resize-column', resizeState.key, resizeState.startWidth + delta);
}

function onResizeEnd() {
  resizeState = null;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  document.body.classList.remove('csv-column-resizing');
}

onUnmounted(() => {
  if (resizeState) onResizeEnd();
});
</script>
