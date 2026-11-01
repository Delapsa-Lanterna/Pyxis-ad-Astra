import { onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';

export function useCsvRowDrag(options: {
  panel: Readonly<Ref<HTMLElement | null>>;
  rowKeys: Readonly<Ref<string[]>>;
  disabled: (copy: boolean) => string;
  context: () => string;
  inputs: FieldInputs;
  select: (rowKey: string, gesture: 'click' | 'drag', ctrl: boolean, shift: boolean) => string[];
  move: (keys: string[], index: number) => void;
  copy: (keys: string[], index: number) => void;
  scrolled: () => void;
}) {
  const feedback = useAppFeedback();
  const insertion = shallowRef<{ rowKey: string; after: boolean; index: number } | null>(null);
  const dragging = shallowRef(false);
  let request: {
    rowKey: string;
    pointerId: number;
    x: number;
    y: number;
    latestX: number;
    latestY: number;
    ready: boolean;
    moved: boolean;
    copy: boolean;
    shift: boolean;
    keys: string[];
  } | null = null;
  let frame = 0,
    previousTime = 0;

  function cancel() {
    const current = request;
    request = null;
    insertion.value = null;
    dragging.value = false;
    cancelAnimationFrame(frame);
    frame = previousTime = 0;
    const panel = options.panel.value;
    if (current && panel?.hasPointerCapture(current.pointerId)) panel.releasePointerCapture(current.pointerId);
  }
  function locate() {
    const current = request,
      panel = options.panel.value;
    if (!current || !panel) return;
    const y = current.latestY - panel.getBoundingClientRect().top + panel.scrollTop - 24;
    const index = Math.max(0, Math.min(options.rowKeys.value.length - 1, Math.floor(y / 24)));
    const rowKey = options.rowKeys.value[index];
    insertion.value = rowKey ? { rowKey, after: y >= index * 24 + 12, index } : null;
  }
  function animate(time: number) {
    const current = request,
      panel = options.panel.value;
    if (!current || !panel) return;
    const rect = panel.getBoundingClientRect();
    const top = rect.top + 24,
      bottom = rect.top + panel.clientHeight;
    const velocity =
      current.latestY < top + 24
        ? -Math.min(1, (top + 24 - current.latestY) / 24)
        : current.latestY > bottom - 24
          ? Math.min(1, (current.latestY - bottom + 24) / 24)
          : 0;
    const before = panel.scrollTop;
    panel.scrollTop += (velocity * 480 * Math.min(time - (previousTime || time), 32)) / 1000;
    previousTime = time;
    if (panel.scrollTop !== before) options.scrolled();
    locate();
    frame = requestAnimationFrame(animate);
  }
  function update() {
    if (!request?.ready) return;
    if (!dragging.value && Math.hypot(request.latestX - request.x, request.latestY - request.y) >= 4) {
      request.moved = true;
      if (options.disabled(request.copy)) return;
      request.keys = options.select(request.rowKey, 'drag', request.copy, request.shift);
      dragging.value = true;
      frame = requestAnimationFrame(animate);
    }
    if (dragging.value) locate();
  }
  function start(rowKey: string, event: PointerEvent) {
    if (event.button !== 0) return;
    cancel();
    const current = {
      rowKey,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      ready: false,
      moved: false,
      copy: event.ctrlKey,
      shift: event.shiftKey,
      keys: [] as string[],
    };
    request = current;
    options.panel.value!.setPointerCapture(event.pointerId);
    void Promise.resolve(options.inputs.commit() ?? true)
      .then((accepted) => {
        if (request !== current) return;
        if (!accepted) {
          cancel();
          return;
        }
        current.ready = true;
        update();
      })
      .catch((error: unknown) => {
        if (request === current) {
          cancel();
          feedback.error(error);
        }
      });
  }
  function onMove(event: PointerEvent) {
    if (!request || request.pointerId !== event.pointerId) return;
    request.latestX = event.clientX;
    request.latestY = event.clientY;
    update();
  }
  function onUp(event: PointerEvent) {
    if (!request || request.pointerId !== event.pointerId) return;
    onMove(event);
    const current = request,
      drop = insertion.value,
      active = dragging.value;
    cancel();
    if (!current.ready) return;
    if (!active) {
      if (!current.moved) options.select(current.rowKey, 'click', current.copy, current.shift);
      return;
    }
    if (!drop || options.disabled(current.copy)) return;
    const boundary = drop.index + Number(drop.after);
    if (current.copy) {
      options.copy(current.keys, boundary);
      return;
    }
    const selected = new Set(current.keys),
      order = options.rowKeys.value;
    const position = boundary - order.slice(0, boundary).filter((key) => selected.has(key)).length;
    const rest = order.filter((key) => !selected.has(key));
    const next = [...rest.slice(0, position), ...current.keys, ...rest.slice(position)];
    if (next.some((key, index) => key !== order[index])) options.move(current.keys, boundary);
  }
  watch(() => [options.disabled(false), options.disabled(true), options.context()], cancel, { flush: 'sync' });
  useWindowShortcuts({
    priority: (event) => {
      if (event.key !== 'Escape' || !request) return false;
      cancel();
      return true;
    },
  });
  onScopeDispose(cancel);
  return { start, onMove, onUp, cancel, insertion, dragging };
}
