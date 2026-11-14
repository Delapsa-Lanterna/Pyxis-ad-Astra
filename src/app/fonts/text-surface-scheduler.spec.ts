import { afterEach, expect, it, vi } from 'vitest';
import { registerTextSurface } from './text-surface-scheduler';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('finishes queued text in bounded frames and releases all surfaces', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0,
    time = 0,
    painted = 0,
    aligned = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  const releases = Array.from({ length: 500 }, () =>
    registerTextSurface({
      element: document.createElement('span'),
      resize() {},
      paint() {
        painted++;
        time++;
      },
      align() {
        aligned++;
      },
    }),
  );
  try {
    let totalFrames = 0;
    while (frames.size) {
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      const before = painted;
      callback(time);
      expect(painted - before).toBeLessThanOrEqual(4);
      totalFrames++;
    }
    expect(painted).toBe(500);
    expect(totalFrames).toBe(126);
    expect(aligned).toBe(500);
  } finally {
    releases.forEach((release) => release());
  }
  expect(frames.size).toBe(0);
});
