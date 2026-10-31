import { effectScope } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { useLayoutFrame } from './use-layout-frame';

afterEach(() => vi.unstubAllGlobals());
it('coalesces observed changes, accepts later frames and cancels pending layout on release', () => {
  let paint!: FrameRequestCallback;
  const request = vi.fn((callback: FrameRequestCallback) => {
    paint = callback;
    return 7;
  });
  const cancel = vi.fn(),
    update = vi.fn(),
    scope = effectScope();
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const schedule = scope.run(() => useLayoutFrame(update))!;
  schedule();
  schedule();
  expect(update).toHaveBeenCalledTimes(0);
  expect(request).toHaveBeenCalledTimes(1);
  paint(0);
  expect(update).toHaveBeenCalledTimes(1);
  schedule();
  scope.stop();
  expect(cancel).toHaveBeenCalledWith(7);
});
