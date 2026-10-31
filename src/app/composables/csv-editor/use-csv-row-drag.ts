import { onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';

export function useCsvRowDrag(options: {
  panel: Readonly<Ref<HTMLElement | null>>;
  rowKeys: Readonly<Ref<string[]>>;
  disabled: () => string;
  context: () => string;
  inputs: FieldInputs;
  select: (rowKey: string) => void;
  move: (rowKey: string, index: number) => void;
  scrolled: () => void;
}) {
  const feedback = useAppFeedback();
  const insertion = shallowRef<{ rowKey: string; after: boolean; index: number } | null>(null);
  const dragging = shallowRef(false);
  let request: { rowKey: string; pointerId: number; x: number; y: number; latestX: number; latestY: number; ready: boolean } | null = null;
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
      dragging.value = true;
      frame = requestAnimationFrame(animate);
    }
    if (dragging.value) locate();
  }
  function start(rowKey: string, event: PointerEvent) {
    if (event.button !== 0 || options.disabled()) return;
    cancel();
    const current = {
      rowKey,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      ready: false,
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
        options.select(rowKey);
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
    if (!current.ready || !active || !drop || options.disabled()) return;
    const from = options.rowKeys.value.indexOf(current.rowKey);
    const boundary = drop.index + Number(drop.after);
    const to = boundary - Number(from < boundary);
    if (from >= 0 && from !== to) options.move(current.rowKey, to);
  }
  watch(() => [options.disabled(), options.context()], cancel, { flush: 'sync' });
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
