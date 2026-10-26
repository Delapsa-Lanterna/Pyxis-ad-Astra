import { describe, expect, it, vi } from 'vitest';
import { createCanvasRecorder } from '@/test/unit/canvas-recorder';
import { projectileAppearance } from '@/domain/editors/projectile-appearance';
import { drawProjectileVisual, type ProjectileVisual } from './projectile-renderer';
const bitmap = { width: 32, height: 32 } as HTMLCanvasElement;
const images = { image: () => bitmap, pattern: () => ({}) as CanvasPattern },
  engines = { product: () => null };
function visual(spec: Parameters<typeof projectileAppearance>[0]): ProjectileVisual {
  return {
    appearance: projectileAppearance(spec),
    point: { x: 10, y: 20 },
    angle: 0.5,
    length: 40,
    alpha: 1,
    phase: 0,
    fringePhase: 0,
    age: 1,
    engineLevel: 1,
  };
}
describe('shared projectile drawing', () => {
  it('finishes texture tiling at a negative floating-point boundary', () => {
    const recording = createCanvasRecorder(),
      item = visual({ specClass: 'beam', width: 12 });
    recording.ctx.clip = vi.fn();
    item.length = 489.99999999999994;
    item.phase = -0.175;
    item.fringePhase = -0.175;
    drawProjectileVisual(recording.ctx, item, images, engines);
    expect(recording.calls('drawImage').length).toBeLessThan(30);
    expect(recording.calls('fillRect')).toHaveLength(2);
    expect(recording.calls('drawImage').every((call) => call.args.slice(1).every(Number.isFinite))).toBe(true);
  });
  it('multiplies charge, source alpha, core width and dark-core passes', () => {
    const recording = createCanvasRecorder(),
      item = visual({ specClass: 'beam', width: 20, coreWidthMult: 0.5, darkCore: true, darkCoreIter: 2, fringeColor: [255, 0, 0, 128] });
    item.alpha = 0.5;
    recording.ctx.clip = vi.fn();
    drawProjectileVisual(recording.ctx, item, images, engines);
    const calls = recording.calls('drawImage');
    expect(calls.some((call) => call.composite === 'source-over' && call.alpha === 0.25)).toBe(true);
    expect(calls.some((call) => call.composite === 'lighter' && Math.abs(call.alpha - (0.25 * 128) / 255) < 0.0001)).toBe(true);
    expect(recording.ctx.globalAlpha).toBe(1);
    expect(recording.ctx.globalCompositeOperation).toBe('source-over');
  });
  it('shares off-center missile geometry and delegates the engine exactly once', () => {
    const recording = createCanvasRecorder(),
      product = vi.fn(() => ({ canvas: bitmap, x: 0, y: 0, ratio: 1 }));
    drawProjectileVisual(
      recording.ctx,
      visual({ specClass: 'missile', size: [12, 30], center: [3, 8], engineSlots: [{ loc: [-10, 6], angle: 180, width: 8, length: 20 }] }),
      images,
      { product },
    );
    expect(recording.calls('drawImage')[0]!.args).toEqual([bitmap, -3, -22, 12, 30]);
    expect(product).toHaveBeenCalledTimes(1);
    expect(product.mock.calls[0]).toBeDefined();
  });
  it('renders both plasma rotation groups', () => {
    const recording = createCanvasRecorder();
    drawProjectileVisual(recording.ctx, visual({ spawnType: 'PLASMA', width: 20 }), images, engines);
    expect(recording.calls('drawImage')).toHaveLength(2);
  });
});
