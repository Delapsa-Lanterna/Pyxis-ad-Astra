export interface TextSurface {
  element: HTMLElement;
  resize: (width: number) => void;
  paint: () => void;
  align: () => (() => void) | undefined;
}
const surfaces = new Map<HTMLElement, TextSurface>();
const paints = new Set<TextSurface>();
const alignments = new Set<TextSurface>();
const widths = new Map<HTMLElement, number>();
let observer: ResizeObserver | null = null,
  frame = 0;
function schedule() {
  if (!frame) frame = requestAnimationFrame(flush);
}
function repaint() {
  for (const surface of surfaces.values()) paints.add(surface);
  schedule();
}
function realign() {
  for (const surface of surfaces.values()) alignments.add(surface);
  schedule();
}
function flush() {
  frame = 0;
  for (const [element, width] of widths) surfaces.get(element)?.resize(width);
  widths.clear();
  const started = performance.now();
  for (const surface of paints) {
    paints.delete(surface);
    surface.paint();
    alignments.add(surface);
    if (performance.now() - started >= 4) break;
  }
  const writes: Array<(() => void) | undefined> = [];
  for (const surface of alignments) {
    alignments.delete(surface);
    writes.push(surface.align());
    if (performance.now() - started >= 4) break;
  }
  for (const write of writes) write?.();
  if (paints.size || alignments.size) schedule();
}
export function queueTextPaint(surface: TextSurface) {
  if (!surfaces.has(surface.element)) return;
  paints.add(surface);
  schedule();
}
export function registerTextSurface(surface: TextSurface) {
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) widths.set(entry.target as HTMLElement, entry.contentRect.width);
      schedule();
    });
    window.addEventListener('scroll', realign, true);
    window.addEventListener('resize', repaint);
  }
  surfaces.set(surface.element, surface);
  observer.observe(surface.element);
  queueTextPaint(surface);
  return () => {
    observer!.unobserve(surface.element);
    surfaces.delete(surface.element);
    widths.delete(surface.element);
    paints.delete(surface);
    alignments.delete(surface);
    if (!surfaces.size) {
      observer!.disconnect();
      observer = null;
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('scroll', realign, true);
      window.removeEventListener('resize', repaint);
    }
  };
}
