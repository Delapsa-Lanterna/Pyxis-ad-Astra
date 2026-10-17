<template>
  <div ref="panelRef" class="table-panel ui-content-scroll ui-content-surface" @scroll="handleScroll">
    <table class="data-table ui-text-small" :style="{ width: `${model.totalWidthPx}px`, minWidth: `${model.totalWidthPx}px` }">
      <CsvGridHeader :columns="model.columns" @resize-column="forwardResizeColumn" />
      <CsvGridBody
        :active-cell="activeCellKey"
        :after-height="afterHeight"
        :before-height="beforeHeight"
        :columns="model.columns"
        :is-dirty="isDirty"
        :selected-row-key="selectedRowKey"
        :source-index="model.sourceIndex"
        :visible-rows="visibleRows"
        @activate-cell="activateCell"
        @close-active-cell="clearActiveCell"
        @select-row="forwardSelectRow"
      />
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, useTemplateRef, watch } from 'vue';
import type { CsvGridRowSlot, CsvRowRecord, ModTableState } from '@/shared/types';
import type { CsvGridColumn, CsvGridModel } from '@/domain/tables/csv-grid-model';
import { useCsvGridViewport } from '@/app/composables/tables/use-csv-grid-viewport';
import CsvGridBody from '@/app/components/tables/CsvGridBody.vue';
import CsvGridHeader from '@/app/components/tables/CsvGridHeader.vue';
import { measurePerformance } from '@/shared/runtime/performance';
import { useCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useImagePreload } from '@/app/composables/use-image-preload';
import { sourceValue } from '@/domain/tables/csv-source-options';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { provideCsvGridMedia } from '@/app/composables/tables/use-csv-grid-media';

const props = defineProps<{
  editing: ModTableState['editing'];
  isDirty: (rowKey: string, column: string) => boolean;
  model: CsvGridModel;
  selectedRowKey: string | null;
}>();

const emit = defineEmits<{
  'request-window': [start: number, count: number];
  'resize-column': [key: string, width: number];
  'select-row': [rowKey: string];
}>();

const panelRef = useTemplateRef<HTMLDivElement>('panelRef');
const context = useCsvTableInputs();
const { commitBefore } = useFieldInputActions(context.inputs);
const activeCellKey = computed(() => (props.editing ? { columnKey: props.editing.column, rowKey: props.editing.rowKey } : null));
const editingIndex = computed(() => {
  const rowKey = props.editing?.rowKey;
  if (!rowKey) return null;
  const index = props.model.rows.findIndex((row) => row.kind === 'row' && row.rowKey === rowKey);
  return index >= 0 ? index : null;
});
const rows = computed(() => props.model.rows);
const viewport = useCsvGridViewport(rows, { editingIndex });
const mode = useInputEditMode(),
  preload = useImagePreload('CSV 网格');
provideCsvGridMedia({ url: (resource) => preload.url(context.target.sessionId, resource) });
function preloadImages() {
  const panel = panelRef.value;
  if (!panel) return;
  const start = Math.floor(panel.scrollTop / 24),
    count = Math.ceil(panel.clientHeight / 24);
  const resources = (items: CsvGridRowSlot[]) =>
    mode.value === 'smart'
      ? items.flatMap((row) =>
          row.kind === 'row'
            ? props.model.columns.flatMap((column) => {
                const option = sourceValue(props.model.sourceIndex, column.schema?.source, String(row.data[column.key] ?? ''));
                return option?.option.resourceRef ? [option.option.resourceRef] : [];
              })
            : [],
        )
      : [];
  preload.prepare(
    context.target.sessionId,
    resources(rows.value.slice(start, start + count)),
    resources(rows.value.slice(Math.max(0, start - count), start + count * 2)),
  );
}
const afterHeight = computed(() => viewport.afterHeight.value);
const beforeHeight = computed(() => viewport.beforeHeight.value);
const visibleRows = computed<CsvGridRowSlot[]>(() => viewport.visibleItems.value);

watch(
  () => props.model,
  () => {
    nextTick(syncViewportMetrics);
  },
);

const resizeObserver = new ResizeObserver(syncViewportMetrics);
onMounted(() => {
  resizeObserver.observe(panelRef.value!);
  nextTick(syncViewportMetrics);
});
onScopeDispose(() => resizeObserver.disconnect());

function handleScroll(event: Event) {
  const panel = event.currentTarget as HTMLDivElement;
  const metrics = { clientHeight: panel.clientHeight, scrollTop: panel.scrollTop };
  void commitBefore(() => {
    viewport.setViewportMetrics(metrics);
    preloadImages();
    clearActiveCell();
    emit('request-window', viewport.startIndex.value, Math.max(0, viewport.endIndex.value - viewport.startIndex.value));
  });
}

function activateCell(row: CsvRowRecord, column: CsvGridColumn) {
  measurePerformance('frontend.csvGrid.activateCell', { column: column.key, rowKey: row.rowKey }, () => {
    void commitBefore(() => {
      forwardSelectRow(row.rowKey);
      context.activate({ ...context.target, rowKey: row.rowKey, column: column.key });
    });
  });
}

function syncViewportMetrics() {
  const panel = panelRef.value;
  viewport.setViewportMetrics({ clientHeight: panel?.clientHeight ?? 0, scrollTop: panel?.scrollTop ?? 0 });
  preloadImages();
  emit('request-window', viewport.startIndex.value, Math.max(0, viewport.endIndex.value - viewport.startIndex.value));
}

function clearActiveCell() {
  context.activate(null);
}

function forwardSelectRow(rowKey: string) {
  void commitBefore(() => measurePerformance('frontend.csvGrid.selectRow', { rowKey }, () => emit('select-row', rowKey)));
}

function forwardResizeColumn(key: string, width: number) {
  emit('resize-column', key, width);
}
</script>
