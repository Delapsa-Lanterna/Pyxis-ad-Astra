import { inject, ref, shallowRef, watch, nextTick, onScopeDispose } from 'vue';
import { immersiveBlockedKey } from '@/app/components/immersive/immersive-render-context';
import { useLayoutFrame } from '@/shared/runtime/use-layout-frame';

export function useImmersiveHover<T>(width: () => number, side: () => 'left' | 'right' = () => 'right') {
  const blocked = inject(immersiveBlockedKey, ref(false));
  const selected = shallowRef<T | null>(null),
    anchor = shallowRef<HTMLElement | null>(null),
    surface = ref<HTMLElement | null>(null);
  const position = ref({ left: '0px', top: '0px' });
  let closeTimer: number | null = null;
  let restoringFocus = false;
  let dismissedAnchor: HTMLElement | null = null;
  let focusOwned = false;
  function keep() {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  function locate() {
    if (!anchor.value || !surface.value) return;
    const origin = anchor.value.getBoundingClientRect(),
      bounds = surface.value.getBoundingClientRect(),
      paneWidth = width();
    const right = origin.right + 3,
      left = origin.left - paneWidth - 3;
    const preferred = side() === 'left' ? (left >= 7 ? left : right) : right + paneWidth + 7 <= window.innerWidth ? right : left;
    const next = {
      left: Math.max(7, Math.min(preferred, window.innerWidth - paneWidth - 7)) + 'px',
      top: Math.max(7, Math.min(origin.top, window.innerHeight - bounds.height - 7)) + 'px',
    };
    if (next.left !== position.value.left || next.top !== position.value.top) position.value = next;
  }
  function show(value: T, element: HTMLElement, intent: 'hover' | 'focus' | 'click' = 'hover') {
    if (blocked.value || restoringFocus || (dismissedAnchor === element && intent !== 'click')) return;
    dismissedAnchor = null;
    focusOwned = intent === 'focus' || (focusOwned && anchor.value === element && intent === 'hover');
    keep();
    selected.value = value;
    anchor.value = element;
    void nextTick(locate);
  }
  function close(focus = false) {
    keep();
    const element = anchor.value;
    if (focus) dismissedAnchor = element;
    selected.value = null;
    anchor.value = null;
    focusOwned = false;
    if (focus)
      void nextTick(() => {
        restoringFocus = true;
        element?.focus({ preventScroll: true });
        restoringFocus = false;
      });
  }
  function leave(event: MouseEvent | FocusEvent) {
    const target = event.relatedTarget;
    if (target instanceof Node && (surface.value?.contains(target) || anchor.value?.contains(target))) return;
    if (
      event.type === 'mouseleave' &&
      focusOwned &&
      (anchor.value?.contains(document.activeElement) || surface.value?.contains(document.activeElement))
    )
      return;
    if (event.currentTarget === dismissedAnchor) dismissedAnchor = null;
    if (selected.value === null) return;
    keep();
    closeTimer = window.setTimeout(() => close(), 100);
  }
  watch(blocked, () => close(), { flush: 'sync' });
  const observer = new ResizeObserver(useLayoutFrame(locate));
  watch(
    surface,
    (next, previous) => {
      if (previous) observer.unobserve(previous);
      if (next) observer.observe(next);
    },
    { flush: 'post' },
  );
  window.addEventListener('resize', locate);
  onScopeDispose(() => {
    keep();
    observer.disconnect();
    window.removeEventListener('resize', locate);
  });
  return { selected, anchor, surface, position, show, leave, keep, close, locate };
}
