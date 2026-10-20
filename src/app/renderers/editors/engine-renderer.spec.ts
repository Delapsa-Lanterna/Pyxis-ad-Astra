import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasRecorder } from '@/test/canvas-recorder';
import { createEngineProduct, engineBounds, enginePaths, engineStyle, type EngineShape } from './engine-renderer';

afterEach(() => vi.restoreAllMocks());
describe('static engine products', () => {
  it('preserves source RGB and alpha, retains the white core, and encloses the entire image', () => {
    const contexts: ReturnType<typeof createCanvasRecorder>[] = [];
    const pixels: Uint8ClampedArray[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const recording = createCanvasRecorder();
      Object.assign(recording.ctx, {
        getImageData: () => ({ data: new Uint8ClampedArray([200, 100, 50, 128]) }),
        putImageData: (image: ImageData) => pixels.push(image.data),
      });
      contexts.push(recording);
      return recording.ctx;
    });
    const image = { width: 32, height: 32 } as HTMLImageElement;
    const shape: EngineShape = { width: 10, length: 40, alpha: 0.55, preset: 'full-thrust', kind: 'missile' };
    const product = createEngineProduct(
      shape,
      { engineColor: [128, 64, 255, 128], glowSizeMult: 2 },
      {
        engineGlow: image,
        engineFlame: image,
        engineHitGlow: image,
      },
      2,
    );
    expect(Array.from(pixels[0]!)).toEqual([100, 25, 50, 128]);
    const core = contexts[0]!.calls('drawImage').at(-1)!;
    expect(core.args[0]).toBe(image);
    expect(core.alpha).toBeCloseTo(0.55 * 0.45);
    expect(product.x).toBeLessThan(-shape.length);
    expect(product.x + product.canvas.width / product.ratio).toBeGreaterThanOrEqual(40);
    expect(product.y + product.canvas.height / product.ratio).toBeGreaterThan(-product.y - 1);
  });
  it('selects textures independently for named, inline and referenced custom styles', () => {
    const styles = { A: { glowSprite: 'graphics/a.png' }, B: { glowOutline: 'graphics/b.png' } };
    expect(enginePaths(engineStyle({ style: 'A' }, styles)).engineGlow).toBe('graphics/a.png');
    expect(enginePaths(engineStyle({ style: 'CUSTOM', styleId: 'B' }, styles)).engineFlame).toBe('graphics/b.png');
    expect(enginePaths(engineStyle({ style: 'CUSTOM', styleSpec: { glowSprite: 'graphics/c.png' } }, styles)).engineGlow).toBe(
      'graphics/c.png',
    );
  });
  it.each(['ship', 'fighter', 'missile'] as const)('keeps the complete %s light band when the outer glow is disabled', (kind) => {
    const shape: EngineShape = { width: 10, length: 40, alpha: 1, preset: 'full-thrust', kind };
    expect(engineBounds(shape, { glowSizeMult: 0 }, 2)).toEqual({ x: -0.5, y: -5.5 });
  });
  it.each([
    ['ship', {}, 9, 0.9],
    ['missile', {}, 9, 0.9],
    ['fighter', {}, 5, 1],
    ['ship', { omegaMode: true }, 5, 0.9],
  ] as const)('preserves the %s static layer profile %j', (kind, style, layers, axis) => {
    const contexts: ReturnType<typeof createCanvasRecorder>[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const recorder = createCanvasRecorder();
      Object.assign(recorder.ctx, { getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {} });
      contexts.push(recorder);
      return recorder.ctx;
    });
    const image = { width: 32, height: 32 } as HTMLImageElement;
    createEngineProduct(
      { width: 10, length: 40, alpha: 1, preset: 'refit', kind },
      style,
      { engineGlow: image, engineFlame: image, engineHitGlow: image },
      1,
    );
    const draws = contexts[0]!.calls('drawImage');
    expect(draws).toHaveLength(layers);
    expect(draws.every((draw) => draw.composite === 'lighter')).toBe(true);
    const glow = draws.at(-2)!;
    expect(Number(glow.args[3]) / Number(glow.args[4])).toBeCloseTo(axis);
  });
});
