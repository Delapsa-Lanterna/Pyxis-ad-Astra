import { vi } from 'vitest';
import { createCanvasRecorder } from './canvas-recorder';

export function installCanvas2DStub(dark = false): () => void {
  const previous = window.matchMedia;
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: media === `(prefers-color-scheme: ${dark ? 'dark' : 'light'})`,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) {
      const ctx = createCanvasRecorder().ctx;
      Object.defineProperty(ctx, 'canvas', { value: this });
      contexts.set(this, ctx);
    }
    return contexts.get(this)!;
  });
  return () => {
    getContext.mockRestore();
    window.matchMedia = previous;
  };
}
