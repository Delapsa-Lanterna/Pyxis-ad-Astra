import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { CsvGridModel } from '@/domain/csv-editor/csv-grid-model';
import type { CsvRowRecord } from '@/shared/types';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

interface RangeCell {
  key: string;
  row?: CsvRowRecord;
  column: string;
}
export function useCsvRangeSelection(options: {
  model: () => CsvGridModel;
  panel: Readonly<Ref<HTMLElement | null>>;
  inputs: FieldInputs;
  current: () => { rowKey: string; column: string } | null;
  activate: (rowKey: string | null, column: string | null) => void;
  context: () => string;
  scrolled: () => void;
}) {
  const first = shallowRef<RangeCell | null>(null),
    last = shallowRef<RangeCell | null>(null);
  const feedback = useAppFeedback();
  const revision = ref(0);
  const rowSelection = shallowRef<RangeCell[] | null>(null),
    rowAnchor = shallowRef<RangeCell | null>(null);
  const rowsMode = computed(() => rowSelection.value !== null);
  const selectedRows = computed(() => {
    const chosen = new Set(rowSelection.value?.map((point) => point.row?.rowKey ?? point.key));
    return options.model().rowKeys.filter((key) => chosen.has(key));
  });
  let pointer: {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    rowKey: string;
    column: string;
    shift: boolean;
    moved: boolean;
    ready: boolean;
  } | null = null;
  let frame = 0,
    suppressClick = false;
  const position = (point: RangeCell) => ({
    row: options.model().rowKeys.indexOf(point.row?.rowKey ?? point.key),
    col: options.model().columns.findIndex((column) => column.key === point.column),
  });
  const bounds = computed(() => {
    const active = options.current();
    if (!active) return null;
    if (rowsMode.value) {
      const positions = selectedRows.value.map((key) => options.model().rowKeys.indexOf(key));
      return positions.length
        ? { top: positions[0]!, bottom: positions.at(-1)!, left: 0, right: options.model().columns.length - 1 }
        : null;
    }
    const a = first.value ? position(first.value) : position({ key: active.rowKey, column: active.column });
    const b = last.value ? position(last.value) : a;
    if (a.row < 0 || b.row < 0 || a.col < 0 || b.col < 0) return null;
    return { top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row), left: Math.min(a.col, b.col), right: Math.max(a.col, b.col) };
  });
  function point(rowKey: string, column: string): RangeCell {
    // Loaded records retain identity when save acceptance replaces temporary keys.
    return { key: rowKey, row: options.model().rowsByKey[rowKey], column };
  }
  function select(rowKey: string, column: string, extend = false, preserve = false) {
    const b = bounds.value,
      model = options.model();
    const row = model.rowKeys.indexOf(rowKey),
      col = model.columns.findIndex((entry) => entry.key === column);
    if (preserve && b && row >= b.top && row <= b.bottom && col >= b.left && col <= b.right) return;
    revision.value++;
    rowSelection.value = null;
    if (extend) {
      const active = options.current();
      if (!first.value && active) first.value = point(active.rowKey, active.column);
      last.value = point(rowKey, column);
    } else first.value = last.value = point(rowKey, column);
  }
  function clear() {
    revision.value++;
    rowSelection.value = rowAnchor.value = null;
    first.value = last.value = null;
    cancel();
  }
  function all() {
    const model = options.model();
    if (!model.rowKeys.length || !model.columns.length) return;
    if (rowsMode.value) {
      setRows(model.rowKeys);
      return;
    }
    revision.value++;
    first.value = point(model.rowKeys[0]!, model.columns[0]!.key);
    last.value = point(model.rowKeys.at(-1)!, model.columns.at(-1)!.key);
    options.activate(first.value.key, first.value.column);
  }
  function set(keys: string[], columns: string[]) {
    revision.value++;
    rowSelection.value = null;
    first.value = point(keys[0]!, columns[0]!);
    last.value = point(keys.at(-1)!, columns.at(-1)!);
    options.activate(keys[0]!, columns[0]!);
  }
  function rowRange(index: number) {
    const b = bounds.value;
    if (rowsMode.value)
      return selectedRows.value.includes(options.model().rowKeys[index]!) ? `0:${options.model().columns.length - 1}` : '';
    return b && index >= b.top && index <= b.bottom ? `${b.left}:${b.right}` : '';
  }
  function setRows(keys: string[], preserveAnchor = false) {
    revision.value++;
    rowSelection.value = keys.map((key) => point(key, options.model().columns[0]!.key));
    if (!preserveAnchor) rowAnchor.value = rowSelection.value[0] ?? null;
    if (keys.length) options.activate(keys[0]!, options.model().columns[0]!.key);
    else options.activate(null, null);
  }
  function selectRow(key: string, ctrl = false, shift = false) {
    const order = options.model().rowKeys;
    let keys = [key];
    if (shift && rowAnchor.value) {
      const from = order.indexOf(rowAnchor.value.row?.rowKey ?? rowAnchor.value.key),
        to = order.indexOf(key);
      keys = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    } else if (ctrl) {
      const current = selectedRows.value;
      keys = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
    }
    setRows(
      order.filter((entry) => keys.includes(entry)),
      true,
    );
    if (!shift) rowAnchor.value = point(key, options.model().columns[0]!.key);
  }
  function dragRows(key: string) {
    if (!selectedRows.value.includes(key)) selectRow(key);
    return [...selectedRows.value];
  }
  function locate() {
    if (!pointer?.ready || !pointer.moved) return;
    const panel = options.panel.value!,
      rect = panel.getBoundingClientRect(),
      model = options.model();
    const row = Math.max(0, Math.min(model.rowKeys.length - 1, Math.floor((pointer.y - rect.top + panel.scrollTop - 24) / 24)));
    const x = pointer.x - rect.left + panel.scrollLeft;
    let left = 16,
      col = 0;
    while (col < model.columns.length - 1 && x >= left + model.columns[col]!.widthPx) left += model.columns[col++]!.widthPx;
    last.value = point(model.rowKeys[row]!, model.columns[col]!.key);
  }
  function animate() {
    const panel = options.panel.value!,
      rect = panel.getBoundingClientRect();
    if (!pointer) return;
    const velocity = (value: number, min: number, max: number) => (value < min + 24 ? -8 : value > max - 24 ? 8 : 0);
    const top = panel.scrollTop,
      left = panel.scrollLeft;
    panel.scrollTop += velocity(pointer.y, rect.top + 24, rect.bottom);
    panel.scrollLeft += velocity(pointer.x, rect.left + 16, rect.right);
    if (top !== panel.scrollTop || left !== panel.scrollLeft) options.scrolled();
    locate();
    frame = requestAnimationFrame(animate);
  }
  function start(event: PointerEvent) {
    suppressClick = false;
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-column-key]');
    if (event.button !== 0 || !cell || (event.target as HTMLElement).closest('[data-csv-picker], .csv-cell-editor')) return;
    event.preventDefault();
    cancel();
    const rowKey = cell.closest<HTMLElement>('[data-row-key]')!.dataset.rowKey!,
      column = cell.dataset.columnKey!;
    const current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      rowKey,
      column,
      shift: event.shiftKey,
      moved: false,
      ready: false,
    };
    pointer = current;
  }
  function move(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!pointer.moved && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 4) {
      pointer.moved = true;
      const current = pointer;
      // Capturing only a real drag leaves native click and double-click targets intact.
      options.panel.value!.setPointerCapture(current.id);
      void Promise.resolve(options.inputs.commit() ?? true)
        .then((accepted) => {
          if (pointer !== current) return;
          if (!accepted) {
            cancel();
            return;
          }
          select(current.rowKey, current.column, current.shift);
          options.activate(current.rowKey, current.column);
          current.ready = true;
          frame = requestAnimationFrame(animate);
          locate();
        })
        .catch((error: unknown) => {
          if (pointer === current) {
            cancel();
            feedback.error(error);
          }
        });
    }
    locate();
  }
  function up(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return;
    move(event);
    suppressClick = pointer.moved;
    cancel();
  }
  function cancel() {
    const current = pointer;
    pointer = null;
    cancelAnimationFrame(frame);
    frame = 0;
    if (current && options.panel.value?.hasPointerCapture(current.id)) options.panel.value.releasePointerCapture(current.id);
  }
  function consumeClick() {
    const value = suppressClick;
    suppressClick = false;
    return value;
  }
  watch(options.context, cancel, { flush: 'sync' });
  watch(
    () => options.model().rowKeys,
    () => {
      if (!bounds.value) clear();
    },
    { flush: 'post' },
  );
  onScopeDispose(cancel);
  return {
    bounds,
    revision,
    rowsMode,
    selectedRows,
    selectRow,
    setRows,
    dragRows,
    select,
    set,
    all,
    clear,
    rowRange,
    start,
    move,
    up,
    cancel,
    consumeClick,
  };
}
