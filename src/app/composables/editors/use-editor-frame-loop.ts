import { onScopeDispose } from 'vue';

export function useEditorFrameLoop(frame: (time: number) => void) {
  let id = 0;
  let running = false;
  let disposed = false;

  function tick(time: number) {
    id = 0;
    if (disposed || !running) return;
    frame(time);
    if (running) id = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(id);
    id = 0;
  }

  function start() {
    if (disposed || running) return;
    running = true;
    id = requestAnimationFrame(tick);
  }

  onScopeDispose(() => {
    disposed = true;
    stop();
  });
  return { start, stop };
}
