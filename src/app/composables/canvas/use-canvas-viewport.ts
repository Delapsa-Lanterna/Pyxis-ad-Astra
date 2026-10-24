import { ref, readonly, type ShallowRef } from 'vue';
import type { Point } from '@/domain/editors/editor-types';
import { useCanvasSurface } from '@/app/composables/canvas/use-canvas-surface';
export type { Point } from '@/domain/editors/editor-types';

type CoordinateSpace = 'ship' | 'weapon';

export function useCanvasViewport(canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>, initialScale: number, maxScale: number) {
  const scale = ref(initialScale);
  const pan = ref<Point>({ x: 0, y: 0 });
  const fitted = ref(false);
  const surface = useCanvasSurface(canvasRef);

  function center(): Point {
    const dimensions = surface.size();
    return { x: dimensions.width / 2 + pan.value.x, y: dimensions.height / 2 + pan.value.y };
  }

  function panBy(dx: number, dy: number) {
    if (dx || dy) fitted.value = false;
    pan.value.x += dx;
    pan.value.y += dy;
  }

  function zoom(deltaY: number) {
    const next = Math.max(0.1, Math.min(maxScale, scale.value * (deltaY < 0 ? 1.1 : 0.9)));
    if (next !== scale.value) fitted.value = false;
    scale.value = next;
  }

  function fit(nextScale: number) {
    pan.value = { x: 0, y: 0 };
    scale.value = nextScale;
    fitted.value = true;
  }

  function toCanvas(space: CoordinateSpace, x: number, y: number): Point {
    const canvasCenter = center();
    if (space === 'ship') {
      return { x: canvasCenter.x + x * scale.value, y: canvasCenter.y - y * scale.value };
    }
    return { x: canvasCenter.x + y * scale.value, y: canvasCenter.y - x * scale.value };
  }

  function fromCanvas(space: CoordinateSpace, x: number, y: number): Point {
    const canvasCenter = center();
    if (space === 'ship') {
      return { x: (x - canvasCenter.x) / scale.value, y: -(y - canvasCenter.y) / scale.value };
    }
    return { x: -(y - canvasCenter.y) / scale.value, y: (x - canvasCenter.x) / scale.value };
  }

  return {
    fit,
    fitted: readonly(fitted),
    center,
    fromCanvas,
    pan,
    panBy,
    resize: surface.resize,
    size: surface.size,
    scale,
    toCanvas,
    zoom,
  };
}

export type CanvasViewport = ReturnType<typeof useCanvasViewport>;
