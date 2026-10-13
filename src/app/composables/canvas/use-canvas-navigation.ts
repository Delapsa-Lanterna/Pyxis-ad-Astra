import { ref } from 'vue';
import type { CanvasViewport } from './use-canvas-viewport';
export function useCanvasNavigation(viewport: CanvasViewport, draw: () => void) {
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
    viewport.zoom(event.deltaY);
    draw();
  }
  return { panning, last, start, move, finish, wheel };
}
