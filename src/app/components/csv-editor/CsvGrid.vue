<template>
  <div ref="gridRef" class="csv-grid ui-content-fill ui-content-contained" @contextmenu.capture="prepareMenu">
    <div
      ref="panelRef"
      data-media-viewport
      class="table-panel ui-content-fill ui-content-scroll ui-content-surface"
      :class="{ 'csv-grid-dragging': drag.dragging.value }"
      @scroll="handleScroll"
      @pointerdown="range.start"
      @pointermove="
        drag.onMove($event);
        range.move($event);
      "
      @pointerup="
        drag.onUp($event);
        range.up($event);
      "
      @pointercancel="
        drag.cancel();
        range.cancel();
      "
      @lostpointercapture="
        drag.cancel();
        range.cancel();
      "
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
          :selected-rows="range.selectedRows.value"
          :selected-column="selectedColumn"
          :range-for-row="range.rowRange"
          :source-index="model.sourceIndex"
          :reorder-disabled-reason="reorderDisabledReason"
          @start-row-drag="drag.start"
          @activate-cell="activateCell"
          @select-row="forwardSelectRow"
        />
      </div>
    </div>
    <!-- Keep composition on one native input until confirmation before mounting the editor. -->
    <Teleport v-if="selectedRowKey && selectedColumn && (!editorTarget || !editorRow)" :to="selectionAnchor ?? panelRef!">
      <textarea
        ref="selectionInput"
        class="csv-cell-selection-input"
        tabindex="-1"
        aria-label="选中单元格，F2 编辑"
        spellcheck="false"
        @compositionstart="composing = true"
        @compositionend="finishComposition"
        @input="typeIntoCell"
      />
    </Teleport>
    <CsvGridEditorHost
      ref="editorHost"
      :target="editorTarget"
      :row="editorRow"
      :column="editorColumn"
      :source-index="model.sourceIndex"
      :anchor-element="editorAnchor"
      :initial-anchor="editorInitialAnchor"
      :edit="cellEdit"
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
import { useLayoutFrame } from '@/shared/runtime/use-layout-frame';
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
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import type { CsvCellEdit } from '@/app/composables/csv-editor/csv-cell-edit';
import { shortcutCommandFromKeyEvent } from '@/shared/lib/keyboard-shortcuts';
import { useCsvRangeSelection } from '@/app/composables/csv-editor/use-csv-range-selection';
import { useCsvRangeActions } from '@/app/composables/csv-editor/use-csv-range-actions';
import { useContextMenuScope } from '@/app/composables/use-context-menu';

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
  'select-row': [rowKey: string | null];
  undo: [];
  redo: [];
}>();

const panelRef = useTemplateRef<HTMLDivElement>('panelRef');
const gridRef = useTemplateRef<HTMLDivElement>('gridRef');
const selectionInput = useTemplateRef<HTMLTextAreaElement>('selectionInput');
const editorHost = useTemplateRef<InstanceType<typeof CsvGridEditorHost>>('editorHost');
const selectedColumn = ref<string | null>(null);
const selectionAnchor = shallowRef<HTMLElement | null>(null);
const cellEdit = shallowRef<CsvCellEdit>({ kind: 'raw' });
let composing = false;
const context = useCsvTableInputs();
const { commitBefore } = useFieldInputActions(context.inputs);
const editorTarget = ref<CsvCellTarget | null>(props.editing ? { ...props.editing } : null);
const editorAnchor = ref<HTMLElement | null>(null);
const editorInitialAnchor = shallowRef<CsvFloatingAnchor | null>(null);
const rows = computed(() => props.model.rowKeys);
const range = useCsvRangeSelection({
  model: () => props.model,
  panel: panelRef,
  inputs: context.inputs,
  current: () => (props.selectedRowKey && selectedColumn.value ? { rowKey: props.selectedRowKey, column: selectedColumn.value } : null),
  activate: selectCell,
  context: () => context.range?.revision() ?? props.reorderContext ?? '',
  scrolled: syncViewportMetrics,
});
const bulk = useCsvRangeActions({ model: () => props.model, selection: range, close: clearActiveCell });
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
  csvRenderColumns(
    props.model.columns,
    scrollLeft.value,
    viewportWidth.value,
    editorTarget.value?.column ?? selectedColumn.value ?? undefined,
    previous,
  ),
);
provideCsvFloatingViewport(panelRef, overlayRef);
watch(
  () => [props.selectedRowKey, selectedColumn.value, props.model.rowKeys] as const,
  async () => {
    await nextTick();
    const index = props.model.rowKeys.indexOf(props.selectedRowKey!);
    const panel = panelRef.value;
    if (index < 0 || !panel) return;
    const top = (index + 1) * 24;
    if (top < panel.scrollTop || top + 24 > panel.scrollTop + panel.clientHeight) panel.scrollTop = top;
    if (selectedColumn.value) {
      const columns = props.model.columns;
      const column = columns.findIndex((entry) => entry.key === selectedColumn.value);
      const left = 16 + columns.slice(0, column).reduce((sum, entry) => sum + entry.widthPx, 0);
      const right = left + columns[column]!.widthPx;
      if (left < panel.scrollLeft + 16) panel.scrollLeft = left - 16;
      else if (right > panel.scrollLeft + panel.clientWidth) panel.scrollLeft = right - panel.clientWidth;
    }
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

function cellAnchor(rowKey: string, column: string) {
  return (
    panelRef.value?.querySelector<HTMLElement>(
      `[data-row-key="${CSS.escape(rowKey)}"] [data-column-key="${CSS.escape(column)}"] .csv-cell-frame`,
    ) ?? null
  );
}
watch(
  () => [props.selectedRowKey, selectedColumn.value, props.model.rowsByKey[props.selectedRowKey!], renderColumns.value],
  () => {
    selectionAnchor.value = selectedColumn.value && props.selectedRowKey ? cellAnchor(props.selectedRowKey, selectedColumn.value) : null;
  },
  { flush: 'post' },
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
  const findAnchor = () => cellAnchor(target.rowKey, target.column);
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
  disabled: (copy) => (context.range?.disabled() ? '数据准备中' : copy ? '' : (props.reorderDisabledReason ?? '')),
  context: () => props.reorderContext ?? JSON.stringify(context.target),
  select: (rowKey, gesture, ctrl, shift) => {
    if (gesture === 'click') range.selectRow(rowKey, ctrl, shift);
    return gesture === 'drag' ? range.dragRows(rowKey) : range.selectedRows.value;
  },
  move: (keys, index) => dropRows('move-rows', keys, index),
  copy: (keys, index) => dropRows('copy-rows', keys, index),
  scrolled: syncViewportMetrics,
});
function dropRows(kind: 'move-rows' | 'copy-rows', keys: string[], index: number) {
  const before = rows.value[index] ?? rows.value.at(-1)!;
  void bulk.run({ kind, keys, before, after: index === rows.value.length });
}
async function deleteRows() {
  if (!range.rowsMode.value) return false;
  await bulk.run({ kind: 'delete-rows' });
  return true;
}
defineExpose({ deleteRows });

watch(
  () => [props.model.rowKeys, props.model.columns],
  () => {
    if (selectedColumn.value && !props.model.columns.some((column) => column.key === selectedColumn.value)) {
      selectedColumn.value = null;
      clearActiveCell();
    }
    void nextTick(syncViewportMetrics);
  },
);

const resizeObserver = new ResizeObserver(useLayoutFrame(syncViewportMetrics));
onMounted(() => {
  resizeObserver.observe(panelRef.value!);
  void nextTick(syncViewportMetrics);
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
  if (range.consumeClick()) return;
  const pickerOpen = editorTarget.value?.rowKey === row.rowKey && editorTarget.value.column === column.key;
  const bounds = range.bounds.value;
  const selected =
    !range.rowsMode.value &&
    bounds?.top === bounds?.bottom &&
    bounds?.left === bounds?.right &&
    props.selectedRowKey === row.rowKey &&
    selectedColumn.value === column.key &&
    !event.shiftKey &&
    !event.ctrlKey;
  const anchor = (event.target as Element).closest('[data-column-key]')?.querySelector<HTMLElement>('.csv-cell-frame') ?? null;
  void commitBefore(() => {
    range.select(row.rowKey, column.key, event.shiftKey, event.type === 'dblclick');
    clearActiveCell();
    if (props.selectedRowKey !== row.rowKey) emit('select-row', row.rowKey);
    selectedColumn.value = column.key;
    selectionAnchor.value = anchor;
    if ((event.target as Element).closest('[data-csv-picker]')) {
      if (!pickerOpen) openEditor(row.rowKey, column.key, { kind: 'picker' });
    } else if (event.type === 'dblclick' || selected) {
      const offsetX = anchor
        ? event.clientX - anchor.getBoundingClientRect().left - parseFloat(getComputedStyle(anchor).paddingLeft || '0')
        : 0;
      openEditor(row.rowKey, column.key, { kind: 'raw', offsetX });
    } else void focusSelection(true);
  });
}

function selectCell(rowKey: string | null, column: string | null) {
  clearActiveCell();
  selectedColumn.value = column;
  emit('select-row', rowKey);
  void focusSelection(true);
}

function prepareMenu(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('.csv-cell-editor, .csv-cell-picker, .csv-cell-text-editor')) return;
  const rowElement = target.closest<HTMLElement>('[data-row-key]');
  if (rowElement && (range.rowsMode.value || target.closest('[role=rowheader]'))) {
    const key = rowElement.dataset.rowKey!;
    if (!range.selectedRows.value.includes(key)) range.selectRow(key);
    return;
  }
  const cell = target.closest<HTMLElement>('[data-column-key]');
  if (!cell) return;
  const rowKey = cell.closest<HTMLElement>('[data-row-key]')!.dataset.rowKey!,
    column = cell.dataset.columnKey!;
  const b = range.bounds.value,
    row = props.model.rowKeys.indexOf(rowKey),
    col = props.model.columns.findIndex((entry) => entry.key === column);
  if (!b || row < b.top || row > b.bottom || col < b.left || col > b.right) {
    range.select(rowKey, column);
    selectCell(rowKey, column);
  }
}

useContextMenuScope({
  identity: () => JSON.stringify([context.range?.revision(), props.selectedRowKey, selectedColumn.value, range.bounds.value]),
  actions: (target) => {
    if (target.closest('.csv-cell-editor, .csv-cell-picker, .csv-cell-text-editor')) return [];
    const row = target.closest<HTMLElement>('[data-row-key]');
    if (row && range.rowsMode.value) {
      const before = row.dataset.rowKey!;
      return (
        [
          ['复制所选行  Ctrl+C', 'copy'],
          ['粘贴  Ctrl+V', 'paste'],
          ['清空  Delete', 'clear'],
          ['插入复制的行', 'insert-rows'],
          ['删除所选行  Ctrl+-', 'delete-rows'],
        ] as const
      ).map(([label, kind]) => ({
        label,
        disabled: bulk.busy.value || context.range?.disabled(),
        run: () => bulk.run(kind === 'insert-rows' ? { kind, before } : { kind }),
      }));
    }
    const cell = target.closest<HTMLElement>('[data-column-key]');
    if (!cell) return [];
    return (
      [
        ['复制  Ctrl+C', 'copy'],
        ['粘贴  Ctrl+V', 'paste'],
        ['清空  Delete', 'clear'],
        ['向下填充  Ctrl+D', 'down'],
        ['向右填充  Ctrl+R', 'right'],
      ] as const
    ).map(([label, action]) => ({
      label,
      disabled: bulk.busy.value || context.range?.disabled(),
      run: async () => {
        if (!range.bounds.value) return;
        await bulk.run({ kind: action });
      },
    }));
  },
});

async function focusSelection(force = false) {
  await nextTick();
  if (!editorTarget.value && (force || document.activeElement === document.body || gridRef.value?.contains(document.activeElement)))
    selectionInput.value?.focus({ preventScroll: true });
}

function openEditor(rowKey: string, column: string, edit: CsvCellEdit) {
  bulk.cancel();
  cellEdit.value = edit;
  editorTarget.value = { ...context.target, rowKey, column };
  setEditorAnchor(cellAnchor(rowKey, column));
  context.activate(editorTarget.value);
}

function typeIntoCell(event: Event) {
  if (composing || !props.selectedRowKey || !selectedColumn.value) return;
  const text = (event.target as HTMLTextAreaElement).value;
  if (text) {
    if (editorTarget.value) cellEdit.value = { kind: 'raw', text };
    else openEditor(props.selectedRowKey, selectedColumn.value, { kind: 'raw', text });
  }
}

function finishComposition(event: CompositionEvent) {
  composing = false;
  typeIntoCell(event);
}

function moveSelection(key: string, reverse: boolean, extend = false) {
  void commitBefore(() => {
    const columns = props.model.columns,
      rows = props.model.rowKeys;
    const row = rows.indexOf(props.selectedRowKey!),
      column = columns.findIndex((entry) => entry.key === selectedColumn.value);
    const direction = reverse ? -1 : 1;
    let nextRow = row,
      nextColumn = column;
    const b = range.bounds.value;
    if (b && (b.top !== b.bottom || b.left !== b.right) && (key === 'Tab' || key === 'Enter')) {
      const height = b.bottom - b.top + 1,
        width = b.right - b.left + 1;
      const position = key === 'Tab' ? (row - b.top) * width + column - b.left : (column - b.left) * height + row - b.top;
      const next = (position + direction + height * width) % (height * width);
      nextRow = b.top + (key === 'Tab' ? Math.floor(next / width) : next % height);
      nextColumn = b.left + (key === 'Tab' ? next % width : Math.floor(next / height));
    } else if (key === 'Tab') {
      const position = row * columns.length + column + direction;
      if (position >= 0 && position < rows.length * columns.length) {
        nextRow = Math.floor(position / columns.length);
        nextColumn = position % columns.length;
      }
    } else if (key === 'Enter' || key === 'ArrowDown' || key === 'ArrowUp') {
      nextRow = Math.max(0, Math.min(rows.length - 1, row + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : direction)));
    } else nextColumn = Math.max(0, Math.min(columns.length - 1, column + (key === 'ArrowLeft' ? -1 : 1)));
    if (extend || key.startsWith('Arrow') || !b || (b.top === b.bottom && b.left === b.right))
      range.select(rows[nextRow]!, columns[nextColumn]!.key, extend);
    clearActiveCell();
    selectedColumn.value = columns[nextColumn]!.key;
    emit('select-row', rows[nextRow]!);
    void focusSelection();
  });
}

useWindowShortcuts({
  priority: (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !gridRef.value?.contains(target) ||
      !selectedColumn.value ||
      !props.selectedRowKey ||
      event.isComposing ||
      composing
    )
      return false;
    const selected = target === selectionInput.value;
    const editing = Boolean(target.closest('.csv-cell-editor, .csv-cell-text-editor, .csv-cell-picker'));
    const rawEditing = target.hasAttribute('data-csv-raw') || !target.closest('.csv-cell-picker');
    if (!selected && !editing) return false;
    const command = selected ? shortcutCommandFromKeyEvent(event, { undoRedoInEditable: true }) : null;
    if (command === 'undo' || command === 'redo') {
      if (command === 'undo') emit('undo');
      else emit('redo');
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (editing && key === 'enter' && rawEditing) {
        const draft = editorHost.value?.capture();
        if (draft) void bulk.run({ kind: 'fill', text: draft.text, accept: draft.accept, current: draft.current });
        return true;
      }
      if (selected && key === 'a') {
        range.all();
        return true;
      }
      if (selected && ['c', 'v', 'd', 'r'].includes(key)) {
        void bulk.run({ kind: key === 'c' ? 'copy' : key === 'v' ? 'paste' : key === 'd' ? 'down' : 'right' });
        return true;
      }
      if (selected && key === '-' && range.rowsMode.value) {
        void deleteRows();
        return true;
      }
    }
    if (selected && event.key === 'Delete') {
      void bulk.run({ kind: 'clear' });
      return true;
    }
    if (event.key === 'Escape' && editing) {
      context.inputs.cancel();
      clearActiveCell();
      void focusSelection();
      return true;
    }
    if (event.key === 'Escape' && selected) {
      range.cancel();
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (selected && event.key === 'F2') {
      openEditor(props.selectedRowKey, selectedColumn.value, { kind: 'raw' });
      return true;
    }
    if (
      event.key === 'Tab' ||
      (event.key === 'Enter' && rawEditing && !target.hasAttribute('data-csv-candidate')) ||
      (selected && event.key.startsWith('Arrow'))
    ) {
      moveSelection(event.key, event.shiftKey, selected && event.shiftKey && event.key.startsWith('Arrow'));
      return true;
    }
    return false;
  },
});

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
  void focusSelection();
}

function forwardSelectRow(rowKey: string) {
  void commitBefore(() => {
    range.clear();
    clearActiveCell();
    selectedColumn.value = null;
    emit('select-row', rowKey);
  });
}

function forwardResizeColumn(key: string, width: number) {
  emit('resize-column', key, width);
}
</script>
