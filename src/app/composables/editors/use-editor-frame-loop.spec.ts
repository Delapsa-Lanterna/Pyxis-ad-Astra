import { effectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorFrameLoop } from './use-editor-frame-loop';

afterEach(() => vi.unstubAllGlobals());

describe('editor frame lifecycle', () => {
  it('owns one loop through start, stop, restart and scope release', () => {
    let id = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    });
    const cancel = vi.fn((frame: number) => callbacks.delete(frame));
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const frame = vi.fn();
    const scope = effectScope();
    const loop = scope.run(() => useEditorFrameLoop(frame))!;
    const advance = (time: number) => {
      const [key, callback] = [...callbacks][0]!;
      callbacks.delete(key);
      callback(time);
    };
    loop.start();
    loop.start();
    expect(callbacks.size).toBe(1);
    advance(100);
    expect(frame).toHaveBeenLastCalledWith(100);
    expect(callbacks.size).toBe(1);
    loop.stop();
    expect(callbacks.size).toBe(0);
    loop.start();
    advance(200);
    expect(frame).toHaveBeenLastCalledWith(200);
    scope.stop();
    expect(callbacks.size).toBe(0);
    expect(cancel).toHaveBeenLastCalledWith(id);
  });
});
