import { describe, expect, it, vi } from 'vitest';
import { projectProjectileGeometry, normalizeProjectileSpec } from '@/domain/spec-editor/projectile/spec-projectile-model';

import { createCanvasPalette } from '@/domain/editors/lib/canvas-palette';
import { createThemeColors } from '@/domain/settings/theme';
import { createCanvasRecorder } from '@/test/unit/canvas-recorder';
import { renderSpecProjectileEditorScene } from './spec-projectile-scene';
import type { RowData } from '@/shared/types/index';

const base = {
  width: 500,
  height: 400,
  center: { x: 250, y: 200 },
  scale: 2,
  palette: createCanvasPalette(createThemeColors('#2563eb', 'light')),
  mirrorY: null,
  cursor: null,
};
function render(spec: RowData, sprite: HTMLImageElement | null = null) {
  const recording = createCanvasRecorder();
  const fills: { color: string | CanvasGradient | CanvasPattern; coords: number[] }[] = [];
  vi.spyOn(recording.ctx, 'fillRect').mockImplementation((...coords) => {
    fills.push({ color: recording.ctx.fillStyle, coords });
  });
  renderSpecProjectileEditorScene(recording.ctx, {
    base,
    geometry: projectProjectileGeometry(normalizeProjectileSpec(spec)),
    images: { image: (key) => (key === 'sprite' || key === 'bulletSprite' ? sprite : null), pattern: () => ({}) as CanvasPattern },
    engineImages: { product: () => null },
  });
  return { recording, fills };
}
describe('projectile static scene', () => {
  it('preserves the source image color and alpha at the projectile dimensions', () => {
    const bitmap = { width: 64, height: 32 } as HTMLImageElement;
    const { recording, fills } = render({ specClass: 'projectile', bulletSprite: 'p.png', length: 40, width: 8 }, bitmap);
    expect(recording.calls('drawImage')[0]).toMatchObject({ args: [bitmap, -4, -4, 8, 4], alpha: 1, composite: 'lighter' });
    expect(fills).toHaveLength(1);
  });
  it('places a missile using its off-center anchor, then overlays range, center and engines', () => {
    const bitmap = { width: 64, height: 128 } as HTMLImageElement;
    const { recording } = render(
      {
        specClass: 'missile',
        size: [12, 30],
        center: [3, 8],
        collisionRadius: 20,
        engineSlots: [
          { loc: [-10, 6], angle: 180, width: 8, length: 20 },
          { loc: [2, -4], angle: 90, width: 6, length: 12 },
        ],
      },
      bitmap,
    );
    expect(recording.calls('drawImage')[0]!.args).toEqual([bitmap, -3, -22, 12, 30]);
    expect(recording.calls('rotate').at(-1)!.args).toEqual([Math.PI / 2]);
    expect(recording.calls('arc')[0]!.args).toEqual([250, 200, 40, 0, Math.PI * 2]);
    expect(recording.calls('arc').map((op) => op.args.slice(0, 2))).toContainEqual([230, 188]);
    expect(recording.calls('arc').map((op) => op.args.slice(0, 2))).toContainEqual([254, 208]);
    const ops = recording.ops.map((op) => op.op);
    expect(ops.indexOf('drawImage')).toBeLessThan(ops.indexOf('arc'));
    expect(ops.indexOf('arc')).toBeLessThan(ops.findIndex((op, i) => op === 'stroke' && i > ops.indexOf('arc')));
    expect(recording.calls('stroke').at(-1)!.alpha).toBe(1);
  });
  it('retains geometric markers for an unresolved sprite reference', () => {
    const { recording, fills } = render({ specClass: 'projectile', bulletSprite: 'missing.png', length: 10, width: 4 });
    expect(fills).toHaveLength(1);
    expect(recording.calls('rect')).toHaveLength(1);
    expect(recording.calls('stroke').length).toBeGreaterThan(2);
  });
});
