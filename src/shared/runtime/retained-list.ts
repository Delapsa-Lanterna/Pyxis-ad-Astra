import { computed, nextTick, onScopeDispose, ref, shallowReactive, watch } from 'vue';
import { debugLog } from './app-log-queue';
let nextListId = 0;

export interface RetainedListItem<T> {
  kind: 'item';
  key: string;
  item: T;
  index: number;
  active: boolean;
  hidden: boolean;
}
export type RetainedListEntry<T> = RetainedListItem<T> | { kind: 'gap'; key: string; height: number };

export function useRetainedList<T>(
  keys: () => readonly string[],
  resolve: (key: string) => T | undefined,
  identity: (item: T) => string,
  rowHeight: number,
  maxBatchSize = Infinity,
) {
  const listId = String(++nextListId);
  const mounted = shallowReactive(new Map<string, RetainedListItem<T>>());
  const scrollTop = ref(0),
    viewportHeight = ref(0);
  const firstVisibleIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight)));
  const lastVisibleIndex = computed(() => Math.min(keys().length, Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight)));
  const startIndex = computed(() => Math.max(0, firstVisibleIndex.value - Math.ceil(viewportHeight.value / rowHeight)));
  const endIndex = computed(() => Math.min(keys().length, lastVisibleIndex.value + Math.ceil(viewportHeight.value / rowHeight)));
  let positions = new Map<string, number>(),
    queue: string[] = [],
    frame = 0,
    generation = 0,
    disposed = false;
  let costPerItem = 0.25;
  const active = shallowReactive(new Set<RetainedListItem<T>>());
  const activeItems = computed(() => [...active].map((view) => view.item));
  const entries = computed<RetainedListEntry<T>[]>(() => {
    const visible = [...mounted.values()].filter((view) => !view.hidden).sort((left, right) => left.index - right.index);
    const result: RetainedListEntry<T>[] = [];
    let index = 0;
    for (const view of visible) {
      if (view.index > index) result.push({ kind: 'gap', key: 'gap:' + index, height: (view.index - index) * rowHeight });
      result.push(view);
      index = view.index + 1;
    }
    if (index < keys().length) result.push({ kind: 'gap', key: 'gap:' + index, height: (keys().length - index) * rowHeight });
    for (const view of mounted.values()) if (view.hidden) result.push(view);
    return result;
  });
  function mount(key: string) {
    const item = resolve(key);
    if (!item) return;
    let view = mounted.get(key);
    if (!view) {
      view = shallowReactive({ kind: 'item' as const, key: 'item:' + key, item, index: positions.get(key)!, active: true, hidden: false });
      mounted.set(key, view);
    } else {
      view.item = item;
      view.active = true;
    }
    active.add(view);
  }
  async function flush() {
    frame = 0;
    const token = generation,
      started = performance.now();
    while (queue.length && token === generation && !disposed) {
      const remaining = 4 - (performance.now() - started);
      if (remaining <= 0) break;
      const count = Math.min(maxBatchSize, Math.max(1, Math.floor(remaining / costPerItem))),
        batch = queue.splice(0, count);
      const before = performance.now();
      for (const key of batch) mount(key);
      await nextTick();
      costPerItem = Math.max(0.05, (performance.now() - before) / batch.length);
    }
    if (queue.length && !disposed && !frame)
      frame = requestAnimationFrame(() => {
        void flush();
      });
  }
  function schedule() {
    generation++;
    for (const view of active) {
      if (view.hidden || view.index < startIndex.value || view.index >= endIndex.value) {
        view.active = false;
        active.delete(view);
      }
    }
    const near = keys().slice(startIndex.value, endIndex.value);
    queue = [];
    for (const key of near) {
      const view = mounted.get(key),
        item = resolve(key);
      if (view && item) {
        view.item = item;
        view.active = true;
        active.add(view);
      } else if (item) queue.push(key);
    }
    queue.sort((left, right) => {
      const rank = (key: string) => {
        const index = positions.get(key)!;
        return index >= firstVisibleIndex.value && index < lastVisibleIndex.value ? 0 : 1;
      };
      return rank(left) - rank(right);
    });
    if (queue.length && !frame)
      frame = requestAnimationFrame(() => {
        void flush();
      });
  }
  watch(
    () => [...keys()],
    (next) => {
      positions = new Map(next.map((key, index) => [key, index]));
      for (const [key, view] of [...mounted]) {
        const current = identity(view.item);
        if (current !== key) {
          mounted.delete(key);
          mounted.set(current, view);
        }
        view.index = positions.get(current) ?? -1;
        const hidden = view.index < 0;
        if (hidden !== view.hidden) debugLog(hidden ? 'list.item_hidden' : 'list.item_restored', () => ({ listId, key: current }));
        view.hidden = hidden;
        const item = resolve(current);
        if (item) view.item = item;
      }
      schedule();
    },
    { immediate: true, flush: 'sync' },
  );
  watch(() => keys().slice(startIndex.value, endIndex.value).map(resolve), schedule, { flush: 'sync' });
  function setViewportMetrics(metrics: { clientHeight: number; scrollTop: number }) {
    viewportHeight.value = metrics.clientHeight;
    scrollTop.value = metrics.scrollTop;
  }
  async function ensure(index: number) {
    const key = keys()[index]!;
    mount(key);
    await nextTick();
    return !disposed && positions.get(key) === index;
  }
  function reset() {
    debugLog('list.released', () => ({ listId, mounted: String(mounted.size) }));
    generation++;
    cancelAnimationFrame(frame);
    frame = 0;
    mounted.clear();
    active.clear();
    queue = [];
  }
  onScopeDispose(() => {
    debugLog('list.released', () => ({ listId, mounted: String(mounted.size) }));
    disposed = true;
    generation++;
    cancelAnimationFrame(frame);
    mounted.clear();
    active.clear();
    queue = [];
  });
  watch([startIndex, endIndex], ([start, end]) =>
    debugLog('list.range_changed', () => ({ listId, start: String(start), end: String(end) })),
  );
  return { entries, activeItems, startIndex, endIndex, firstVisibleIndex, lastVisibleIndex, setViewportMetrics, ensure, reset };
}
