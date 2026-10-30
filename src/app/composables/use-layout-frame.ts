import { onScopeDispose } from 'vue';

export function useLayoutFrame(update: () => void) {
  let frame = 0;
  onScopeDispose(() => cancelAnimationFrame(frame));
  return () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
  };
}
