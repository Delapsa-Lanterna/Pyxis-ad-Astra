<template>
  <div class="csv-grid ui-content-fill ui-content-contained">
    <div
      ref="panelRef"
      data-media-viewport
      class="table-panel ui-content-fill ui-content-scroll ui-content-surface"
      :class="{ 'csv-grid-dragging': drag.dragging.value }"
      @scroll="handleScroll"
      @pointermove="drag.onMove"
      @pointerup="drag.onUp"
      @pointercancel="drag.cancel"
      @lostpointercapture="drag.cancel"
    >
      <div
        class="data-table ui-text-small"
        role="grid"
        :aria-rowcount="model.rowKeys.length + 1"
        :aria-colcount="model.columns.length + 1"
        :style="tableStyle"
      >
        <CsvGridHeader :columns="model.columns" @resize-column="forwardResizeColumn" />
        <CsvGridBody
          :entries="viewport.entries.value"
          :columns="renderColumns"
          :is-dirty="isDirty"
          :selected-row-key="selectedRowKey"
          :source-index="model.sourceIndex"
          :reorder-disabled-reason="reorderDisabledReason"
          @start-row-drag="drag.start"
          @activate-cell="activateCell"
          @select-row="forwardSelectRow"
        />
      </div>
    </div>
    <CsvGridEditorHost
      :target="editorTarget"
      :row="editorRow"
      :column="editorColumn"
      :source-index="model.sourceIndex"
      :anchor-element="editorAnchor"
      :initial-anchor="editorInitialAnchor"
      @close="clearActiveCell"
    />
    <div ref="overlayRef" class="csv-grid-overlay">
      <div
        v-if="drag.insertion.value"
        class="csv-grid-insertion"
        :style="{ top: 24 + (drag.insertion.value.index + Number(drag.insertion.value.after)) * 24 - scrollTop + 'px' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLayoutFrame } from '@/app/composables/use-layout-frame';
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { CsvCellTarget, CsvRowRecord, CsvModState } from '@/shared/types';
import { csvRenderColumns, type CsvGridColumn, type CsvGridModel, type CsvRenderColumn } from '@/domain/csv-editor/csv-grid-model';
import { useRetainedList } from '@/shared/runtime/retained-list';
import { provideCsvFloatingViewport, type CsvFloatingAnchor } from '@/app/composables/csv-editor/use-csv-floating-panel';
import CsvGridBody from '@/app/components/csv-editor/CsvGridBody.vue';
import CsvGridHeader from '@/app/components/csv-editor/CsvGridHeader.vue';
import CsvGridEditorHost from '@/app/components/csv-editor/CsvGridEditorHost.vue';
import { useCsvTableInputs } from '@/app/composables/csv-editor/use-csv-table-inputs';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useThumbnailPreload } from '@/app/composables/use-thumbnail-preload';
import { resourceThumbnailRequest } from '@/app/composables/use-resource-thumbnail';
import { sourceValue } from '@/domain/schema/csv-source-options';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { provideCsvGridMedia } from '@/app/composables/csv-editor/use-csv-grid-media';
import { useCsvRowDrag } from '@/app/composables/csv-editor/use-csv-row-drag';

const props = defineProps<{
  reorderDisabledReason?: string;
  reorderContext?: string;
  editing: CsvModState['editing'];
  isDirty: (rowKey: string, column: string) => boolean;
  model: CsvGridModel;
  selectedRowKey: string | null;
}>();

const emit = defineEmits<{
  'request-window': [start: number, count: number];
  'resize-column': [key: string, width: number];
  'select-row': [rowKey: string];
  'move-row': [rowKey: string, index: number];
}>();

const panelRef = useTemplateRef<HTMLDivElement>('panelRef');
const context = useCsvTableInputs();
const { commitBefore } = useFieldInputActions(context.inputs);
const editorTarget = ref<CsvCellTarget | null>(props.editing ? { ...props.editing } : null);
const editorAnchor = ref<HTMLElement | null>(null);
const editorInitialAnchor = shallowRef<CsvFloatingAnchor | null>(null);
const rows = computed(() => props.model.rowKeys);
const tableStyle = computed(() => ({
  width: props.model.totalWidthPx + 16 + 'px',
  minWidth: props.model.totalWidthPx + 16 + 'px',
  height: (props.model.rowKeys.length + 1) * 24 + 'px',
  '--csv-columns': '16px ' + props.model.columns.map((column) => column.widthPx + 'px').join(' '),
}));
const viewport = useRetainedList(
  () => props.model.rowKeys,
  (key) => props.model.rowsByKey[key],
  (row) => row.rowKey,
  24,
  4,
);
const overlayRef = useTemplateRef<HTMLDivElement>('overlayRef');
const scrollTop = ref(0),
  scrollLeft = ref(0),
  viewportWidth = ref(0),
  viewportHeight = ref(0);
const renderColumns = computed<CsvRenderColumn[]>((previous) =>
  csvRenderColumns(props.model.columns, scrollLeft.value, viewportWidth.value, editorTarget.value?.column, previous),
);
provideCsvFloatingViewport(panelRef, overlayRef);
watch(
  () => [props.selectedRowKey, props.model.rowKeys] as const,
  async () => {
    await nextTick();
    const index = props.model.rowKeys.indexOf(props.selectedRowKey!);
    const panel = panelRef.value;
    if (index < 0 || !panel) return;
    const top = (index + 1) * 24;
    if (top < panel.scrollTop || top + 24 > panel.scrollTop + panel.clientHeight) panel.scrollTop = top;
    syncViewportMetrics();
  },
  { immediate: true, flush: 'post' },
);

function targetKey(target: CsvCellTarget | null): string {
  return target ? JSON.stringify([target.sessionId, target.modRoot, target.table, target.rowKey, target.column]) : '';
}

const editorRow = computed(() => (editorTarget.value ? (props.model.rowsByKey[editorTarget.value.rowKey] ?? null) : null));
const editorColumn = computed(() =>
  editorTarget.value ? (props.model.columns.find((column) => column.key === editorTarget.value!.column) ?? null) : null,
);

let anchorGeneration = 0;
function setEditorAnchor(anchor: HTMLElement | null) {
  if (anchor === editorAnchor.value) return;
  editorInitialAnchor.value = anchor?.getBoundingClientRect() ?? null;
  editorAnchor.value = anchor;
}
async function locateEditorAnchor() {
  const generation = ++anchorGeneration;
  const target = editorTarget.value;
  if (!target) {
    setEditorAnchor(null);
    return;
  }
  const panel = panelRef.value;
  const findAnchor = () => {
    const row = [...(panel?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])].find(
      (element) => element.dataset.rowKey === target.rowKey,
    );
    const cell = [...(row?.querySelectorAll<HTMLElement>('[data-column-key]') ?? [])].find(
      (element) => element.dataset.columnKey === target.column,
    );
    return cell?.querySelector<HTMLElement>('.csv-cell-frame') ?? null;
  };
  let anchor = findAnchor();
  if (!anchor) {
    const index = props.model.rowKeys.indexOf(target.rowKey);
    if (index >= 0) {
      await viewport.ensure(index);
      await nextTick();
      if (generation !== anchorGeneration) return;
      anchor = findAnchor();
    }
  }
  if (generation === anchorGeneration) setEditorAnchor(anchor);
}

watch(
  () => targetKey(props.editing),
  () => {
    const nextTarget = props.editing ? { ...props.editing } : null;
    if (targetKey(editorTarget.value) !== targetKey(nextTarget)) {
      editorTarget.value = nextTarget;
    }
  },
  { immediate: true },
);
watch([editorRow, editorColumn], locateEditorAnchor, { flush: 'post', immediate: true });
const mode = useInputEditMode(),
  preload = useThumbnailPreload('CSV 网格');
provideCsvGridMedia({ url: (resource) => preload.url(context.target.sessionId, resource) });
// Keep media demand independent of row mounting; per-batch rescans consume the 4 ms mount budget.
const mediaRequests = computed(() => {
  const start = Math.floor(scrollTop.value / 24),
    count = Math.ceil(viewportHeight.value / 24);
  const resources = (keys: string[], columns: CsvRenderColumn[]) =>
    mode.value === 'smart'
      ? keys.flatMap((key) => {
          const row = props.model.rowsByKey[key];
          return row
            ? columns.flatMap(({ column }) => {
                const resource = sourceValue(props.model.sourceIndex, column.schema?.source, String(row.data[column.key] ?? ''))?.option
                  .resourceRef;
                return resource ? [resourceThumbnailRequest(context.target.sessionId, resource, 16, 16)] : [];
              })
            : [];
        })
      : [];
  const visible = renderColumns.value.filter(
    (view) => view.offsetPx + view.column.widthPx > scrollLeft.value + 16 && view.offsetPx < scrollLeft.value + viewportWidth.value,
  );
  return {
    visible: resources(rows.value.slice(start, start + count), visible),
    near: resources(rows.value.slice(Math.max(0, start - count), start + count * 2), renderColumns.value),
  };
});
watch(mediaRequests, ({ visible, near }) => preload.prepare(context.target.sessionId, visible, near), { immediate: true });
const drag = useCsvRowDrag({
  panel: panelRef,
  rowKeys: rows,
  inputs: context.inputs,
  disabled: () => props.reorderDisabledReason ?? '',
  context: () => props.reorderContext ?? JSON.stringify(context.target),
  select: (rowKey) => emit('select-row', rowKey),
  move: (rowKey, index) => emit('move-row', rowKey, index),
  scrolled: syncViewportMetrics,
});

watch(
  () => [props.model.rowKeys, props.model.columns],
  () => {
    nextTick(syncViewportMetrics);
  },
);

const resizeObserver = new ResizeObserver(useLayoutFrame(syncViewportMetrics));
onMounted(() => {
  resizeObserver.observe(panelRef.value!);
  nextTick(syncViewportMetrics);
});
onScopeDispose(() => resizeObserver.disconnect());

let scrollFrame = 0;
function handleScroll() {
  if (!scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      syncViewportMetrics();
    });
}
onScopeDispose(() => cancelAnimationFrame(scrollFrame));

function activateCell(row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent) {
  const anchor = (event.target as Element).closest('[data-column-key]')?.querySelector<HTMLElement>('.csv-cell-frame') ?? null;
  void commitBefore(() => {
    if (props.selectedRowKey !== row.rowKey) emit('select-row', row.rowKey);
    const target = { ...context.target, rowKey: row.rowKey, column: column.key };
    editorTarget.value = target;
    setEditorAnchor(anchor);
    context.activate(target);
  });
}

// Read viewport geometry at scroll/resize boundaries to keep layout work out of the mount loop.
function syncViewportMetrics() {
  const panel = panelRef.value;
  scrollTop.value = panel?.scrollTop ?? 0;
  scrollLeft.value = panel?.scrollLeft ?? 0;
  viewportWidth.value = panel?.clientWidth ?? 0;
  viewportHeight.value = panel?.clientHeight ?? 0;
  viewport.setViewportMetrics({ clientHeight: viewportHeight.value, scrollTop: scrollTop.value });
  emit('request-window', viewport.startIndex.value, Math.max(0, viewport.endIndex.value - viewport.startIndex.value));
}

function clearActiveCell() {
  anchorGeneration++;
  editorTarget.value = null;
  setEditorAnchor(null);
  context.activate(null);
}

function forwardSelectRow(rowKey: string) {
  void commitBefore(() => emit('select-row', rowKey));
}

function forwardResizeColumn(key: string, width: number) {
  emit('resize-column', key, width);
}
</script>
