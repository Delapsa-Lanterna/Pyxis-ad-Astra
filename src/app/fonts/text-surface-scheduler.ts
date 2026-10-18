export interface TextSurface {
  element: HTMLElement;
  resize: (width: number) => void;
  paint: () => void;
  align: () => (() => void) | undefined;
}
const surfaces = new Map<HTMLElement, TextSurface>();
const paints = new Set<TextSurface>();
let observer: ResizeObserver | null = null,
  frame = 0;
function schedule() {
  if (!frame) frame = requestAnimationFrame(flush);
}
function repaint() {
  for (const surface of surfaces.values()) paints.add(surface);
  schedule();
}
function flush() {
  frame = 0;
  for (const surface of paints) surface.paint();
  paints.clear();
  const writes = [...surfaces.values()].map((surface) => surface.align());
  for (const write of writes) write?.();
}
export function queueTextPaint(surface: TextSurface) {
  if (!surfaces.has(surface.element)) return;
  paints.add(surface);
  schedule();
}
export function registerTextSurface(surface: TextSurface) {
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) surfaces.get(entry.target as HTMLElement)?.resize(entry.contentRect.width);
    });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', repaint);
  }
  surfaces.set(surface.element, surface);
  observer.observe(surface.element);
  queueTextPaint(surface);
  return () => {
    observer!.unobserve(surface.element);
    surfaces.delete(surface.element);
    paints.delete(surface);
    if (!surfaces.size) {
      observer!.disconnect();
      observer = null;
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', repaint);
    }
  };
}
