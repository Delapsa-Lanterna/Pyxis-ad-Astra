import { computed, inject, onScopeDispose, provide, ref, type CSSProperties, type InjectionKey, type Ref } from 'vue';

interface CsvFloatingViewport {
  panel: Readonly<Ref<HTMLElement | null>>;
  overlay: Readonly<Ref<HTMLElement | null>>;
}
const csvFloatingViewportKey: InjectionKey<CsvFloatingViewport> = Symbol('csv-floating-viewport');
export function provideCsvFloatingViewport(panel: CsvFloatingViewport['panel'], overlay: CsvFloatingViewport['overlay']) {
  provide(csvFloatingViewportKey, { panel, overlay });
}
export function useCsvFloatingViewport() {
  return inject(csvFloatingViewportKey, null);
}

export interface CsvFloatingAnchor {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function useCsvFloatingPanel(anchor: () => CsvFloatingAnchor, height: number) {
  const own = useCsvFloatingViewport();
  const bounds = () => {
    const panel = own?.panel.value;
    const rect = panel?.getBoundingClientRect();
    return {
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      width: panel?.clientWidth ?? window.innerWidth,
      height: panel?.clientHeight ?? window.innerHeight,
    };
  };
  const viewport = ref(bounds());
  const resized = () => {
    viewport.value = bounds();
  };
  window.addEventListener('resize', resized);
  window.addEventListener('scroll', resized, true);
  onScopeDispose(() => {
    window.removeEventListener('resize', resized);
    window.removeEventListener('scroll', resized, true);
  });
  return computed<CSSProperties>(() => {
    const rect = anchor();
    const width = Math.min(Math.max(rect.width, 300), 600, viewport.value.width - 8);
    const localLeft = rect.left - viewport.value.left,
      localTop = rect.top - viewport.value.top;
    const left = Math.max(4, Math.min(localLeft, viewport.value.width - width - 4));
    const top = localTop + rect.height + 2;
    const spaceBelow = viewport.value.height - top;
    const flipUp = spaceBelow < height && localTop - 2 > spaceBelow;
    const hidden =
      localTop + rect.height <= 24 || localTop >= viewport.value.height || localLeft + rect.width <= 0 || localLeft >= viewport.value.width;
    return {
      bottom: flipUp ? `${viewport.value.height - localTop + 2}px` : undefined,
      left: `${left}px`,
      maxHeight: `${Math.max(0, Math.min(height, flipUp ? localTop - 2 : spaceBelow))}px`,
      top: flipUp ? undefined : `${top}px`,
      width: `${width}px`,
      pointerEvents: hidden ? 'none' : 'auto',
      clipPath: hidden ? 'inset(100%)' : undefined,
    };
  });
}
