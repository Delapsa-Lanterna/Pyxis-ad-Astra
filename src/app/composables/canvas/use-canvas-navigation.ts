import { ref } from 'vue';
import type { CanvasViewport } from './use-canvas-viewport';
export function useCanvasNavigation(viewport: CanvasViewport, draw: () => void, zoomAnchor: 'center' | 'pointer' = 'center') {
  const panning = ref(false),
    last = { x: 0, y: 0 };
  function start(event: MouseEvent) {
    last.x = event.offsetX;
    last.y = event.offsetY;
    if (event.button === 2) {
      panning.value = true;
      return true;
    }
    return false;
  }
  function move(event: MouseEvent) {
    const dx = event.offsetX - last.x,
      dy = event.offsetY - last.y;
    last.x = event.offsetX;
    last.y = event.offsetY;
    if (panning.value) {
      viewport.panBy(dx, dy);
      draw();
      return true;
    }
    return false;
  }
  function finish() {
    panning.value = false;
  }
  function wheel(event: WheelEvent) {
    const center = viewport.center(),
      scale = viewport.scale.value;
    viewport.zoom(event.deltaY);
    if (zoomAnchor === 'pointer') {
      const ratio = viewport.scale.value / scale;
      viewport.panBy((event.offsetX - center.x) * (1 - ratio), (event.offsetY - center.y) * (1 - ratio));
    }
    draw();
  }
  return { panning, last, start, move, finish, wheel };
}
