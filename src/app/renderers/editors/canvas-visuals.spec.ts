import { outlineStyle, controlPointStyle, centerMarkerStyle, weaponSlotStyle, launchBayPortStyle, barrelStyle } from './canvas-styles';
import { createCanvasRecorder } from '@/test/canvas-recorder';
import { describe, expect, it } from 'vitest';
import type { Point } from '@/domain/editors/editor-types';
import { createCanvasPalette } from '@/domain/editors/lib/canvas-palette';
import { ACCENT_PRESETS, createThemeColors } from '@/domain/settings/theme';
import { WEAPON_COLORS } from '@/shared/lib/starsector';
import { drawEngineVisual, engineStyle, engineDimensions } from './engine-renderer';
import {
  drawBarrelVisual,
  drawBoundsVisual,
  drawControlPoint,
  drawCrossMarker,
  drawLaunchBayPortVisual,
  drawRadiusField,
  drawWeaponSlotVisual,
  drawWeaponSpriteLayer,
  drawWeaponGlow,
  drawXMarker,
} from './canvas-visuals';

const point: Point = { x: 10, y: 20 };
const palette = createCanvasPalette(createThemeColors('#2563eb', 'light'));

describe('canvas theme projection', () => {
  it.each([...ACCENT_PRESETS.map((preset) => preset.hex), '#123456'])('consumes existing theme tokens for %s', (accent) => {
    for (const theme of ['light', 'dark'] as const) {
      const tokens = createThemeColors(accent, theme);
      const colors = createCanvasPalette(tokens);
      expect(colors.background).toBe(tokens.panelMuted);
      expect(colors.grid).toBe(tokens.border);
      expect(colors.highlight).toBe(tokens.primary);
      expect(colors.marker).toBe('#ffffff');
      expect(colors.outline).toBe('#000000');
    }
  });
});

describe('drawWeaponSlotVisual', () => {
  it.each(Object.entries(WEAPON_COLORS))('retains the %s semantic color', (type, color) => {
    const recorder = createCanvasRecorder();
    drawWeaponSlotVisual(recorder.ctx, {
      angle: 0,
      arc: 120,
      mount: 'HARDPOINT',
      point,
      size: 'MEDIUM',
      type,
      style: weaponSlotStyle(type, 1),
    });
    expect(recorder.calls('fill').at(-1)!.args[0]).toBe(color);
    expect(recorder.calls('stroke').some((entry) => entry.args[0] === color)).toBe(true);
  });
  it('draws the slot center at full alpha when selected', () => {
    const recorder = createCanvasRecorder();
    drawWeaponSlotVisual(recorder.ctx, {
      angle: 0,
      arc: 120,
      mount: 'TURRET',
      point,
      size: 'MEDIUM',
      type: 'BALLISTIC',
      style: weaponSlotStyle('BALLISTIC', 1),
    });
    const fills = recorder.calls('fill');
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.at(-1)!.alpha).toBe(1);
    expect(recorder.calls('translate')[0]!.args).toEqual([point.x, point.y]);
  });

  it('renders unselected slots dimmed', () => {
    const recorder = createCanvasRecorder();
    drawWeaponSlotVisual(recorder.ctx, {
      angle: 0,
      arc: 120,
      mount: 'TURRET',
      point,
      size: 'SMALL',
      type: 'ENERGY',
      style: weaponSlotStyle('ENERGY', 0.6),
    });
    expect(recorder.calls('stroke').every((entry) => entry.alpha === 0.6)).toBe(true);
  });

  it('skips the facing arc for launch bays but keeps the hash outline', () => {
    const recorder = createCanvasRecorder();
    drawWeaponSlotVisual(recorder.ctx, {
      angle: 0,
      arc: 360,
      mount: 'HIDDEN',
      point,
      size: 'LARGE',
      type: 'LAUNCH_BAY',
      style: weaponSlotStyle('LAUNCH_BAY', 0.6),
    });
    expect(recorder.calls('rotate')).toHaveLength(0);
    expect(recorder.calls('stroke').length).toBeGreaterThan(0);
  });

  it('uses the fallback color for unknown slot types', () => {
    const recorder = createCanvasRecorder();
    drawWeaponSlotVisual(recorder.ctx, {
      angle: 0,
      arc: 0,
      mount: 'TURRET',
      point,
      size: 'MEDIUM',
      type: 'MYSTERY',
      style: weaponSlotStyle('MYSTERY', 1),
    });
    const fills = recorder.calls('fill');
    expect(fills.at(-1)!.args[0]).toBe('#9ca3af');
  });
});

describe('drawBoundsVisual', () => {
  it('draws nothing for fewer than two points', () => {
    const recorder = createCanvasRecorder();
    drawBoundsVisual(
      recorder.ctx,
      [point],
      { ...outlineStyle(palette, 2), outlineWidth: 4 },
      [point].map((_, index) => controlPointStyle(palette, index === 0, index === null, 6)),
    );
    expect(recorder.calls('stroke')).toHaveLength(0);
  });

  it('closes the polygon and marks every control point', () => {
    const recorder = createCanvasRecorder();
    const points = [point, { x: 30, y: 20 }, { x: 30, y: 60 }];
    drawBoundsVisual(
      recorder.ctx,
      points,
      { ...outlineStyle(palette, 2), outlineWidth: 4 },
      points.map((_, index) => controlPointStyle(palette, index === 1, index === 2, 6)),
    );
    expect(recorder.calls('closePath')).toHaveLength(1);
    expect(recorder.calls('arc').length).toBe(3);
    expect(
      recorder
        .calls('stroke')
        .slice(0, 2)
        .map((entry) => entry.args),
    ).toEqual([
      ['#000000', 4],
      ['#ffffff', 2],
    ]);
    expect(recorder.calls('fill').map((entry) => entry.args[0])).toEqual(['#ffffff', palette.highlight, palette.highlight]);
  });
});

describe('markers and control points', () => {
  it('skips radius fill for zero radius but keeps the marker', () => {
    const recorder = createCanvasRecorder();
    drawRadiusField(recorder.ctx, point, 0, 'rgba(0,0,0,1)', centerMarkerStyle(palette, true, false));
    expect(recorder.calls('fill')).toHaveLength(0);
    expect(recorder.calls('moveTo').length).toBeGreaterThan(0);
  });

  it('fills the radius circle when positive', () => {
    const recorder = createCanvasRecorder();
    drawRadiusField(recorder.ctx, point, 50, 'rgba(1,2,3,1)', centerMarkerStyle(palette, false, false));
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('fill')[0]!.args[0]).toBe('rgba(1,2,3,1)');
  });

  it('draws the cross marker as plus lines and the x marker as diagonals', () => {
    const cross = createCanvasRecorder();
    drawCrossMarker(cross.ctx, point, centerMarkerStyle(palette, false, false));
    expect(cross.calls('moveTo')).toHaveLength(2);
    const x = createCanvasRecorder();
    drawXMarker(x.ctx, point, centerMarkerStyle(palette, false, false));
    expect(x.calls('moveTo')).toHaveLength(2);
  });

  it('outlines selected control points with a stroke ring', () => {
    const recorder = createCanvasRecorder();
    drawControlPoint(recorder.ctx, point, controlPointStyle(palette, true, false));
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('stroke')).toHaveLength(1);
    expect(recorder.calls('fill')[0]!.args[0]).toBe(palette.highlight);
    expect(recorder.calls('stroke')[0]!.args).toEqual(['#000000', 1]);
  });

  it('outlines ordinary white markers on either theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const colors = createCanvasPalette(createThemeColors('#ea580c', theme));
      const recorder = createCanvasRecorder();
      drawCrossMarker(recorder.ctx, point, centerMarkerStyle(colors, false, false));
      expect(recorder.calls('stroke').map((entry) => entry.args)).toEqual([
        ['#000000', 3],
        ['#ffffff', 2],
      ]);
      const control = createCanvasRecorder();
      drawControlPoint(control.ctx, point, controlPointStyle(colors, false, false));
      expect(control.calls('fill')[0]!.args[0]).toBe('#ffffff');
      expect(control.calls('stroke')[0]!.args).toEqual(['#000000', 1]);
    }
  });
});

describe('drawLaunchBayPortVisual', () => {
  it('draws the larger accent dot for the active port', () => {
    const recorder = createCanvasRecorder();
    drawLaunchBayPortVisual(recorder.ctx, { point, style: launchBayPortStyle(1, false, true) });
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('arc')[0]!.args[2]).toBe(4.5);
    expect(recorder.calls('stroke')).toHaveLength(1);
  });

  it('draws the small dot and ring for passive ports', () => {
    const recorder = createCanvasRecorder();
    drawLaunchBayPortVisual(recorder.ctx, { point, style: launchBayPortStyle(0.65, false, false) });
    expect(recorder.calls('fill')).toHaveLength(1);
    expect(recorder.calls('arc')[0]!.args[2]).toBe(2.2);
    expect(recorder.calls('stroke')).toHaveLength(1);
  });
});

describe('drawEngineVisual', () => {
  it.each([1, 0.55])('draws a finished product with baked %s opacity and restores the context', (alpha) => {
    const recorder = createCanvasRecorder(),
      bitmap = { width: 100, height: 80 } as HTMLCanvasElement;
    drawEngineVisual(
      recorder.ctx,
      { rotation: Math.PI, length: 30, point, scale: 2, width: 10, alpha, preset: 'full-thrust', kind: 'ship' },
      {
        product: (shape) => {
          expect(shape.alpha).toBe(alpha);
          return { canvas: bitmap, x: -5, y: -10, ratio: 2 };
        },
      },
    );
    expect(recorder.calls('drawImage').map((call) => ({ args: call.args, alpha: call.alpha, composite: call.composite }))).toEqual([
      { args: [bitmap, -5, -10, 50, 40], alpha: 1, composite: 'lighter' },
    ]);
    expect(recorder.calls('rotate')[0]!.args).toEqual([Math.PI]);
    expect(recorder.calls('scale')[0]!.args).toEqual([2, 2]);
    expect(recorder.ctx.globalAlpha).toBe(1);
    expect(recorder.ctx.globalCompositeOperation).toBe('source-over');
  });
  it('uses the owning custom or named color and defaults missing colors to white', () => {
    const styles = { TEST: { engineColor: [4, 5, 6, 7] }, CUSTOM: { engineColor: [8, 9, 10] } };
    expect(engineStyle({ style: 'TEST' }, styles)).toEqual(styles.TEST);
    expect(engineStyle({ style: 'CUSTOM', styleSpec: { engineColor: [1, 2, 3, 4] } }, styles)).toEqual({ engineColor: [1, 2, 3, 4] });
    expect(engineStyle({ style: 'CUSTOM', styleId: 'TEST' }, styles)).toEqual(styles.TEST);
    expect(engineStyle({ style: 'MISSING' }, styles)).toEqual({});
  });
  it('uses full and refit geometry without pose-dependent state', () => {
    const shape = { width: 10, length: 40, kind: 'ship' as const, alpha: 1 };
    expect(engineDimensions({ ...shape, preset: 'full-thrust' })).toMatchObject({ width: 10, length: 40, level: 1 });
    expect(engineDimensions({ ...shape, preset: 'refit' })).toMatchObject({ width: 5.05, length: 8, level: 0.4 });
  });
});

describe('sprite and barrel layers', () => {
  it('skips the sprite layer when the image has no width', () => {
    const recorder = createCanvasRecorder();
    drawWeaponSpriteLayer(recorder.ctx, { width: 0, height: 0 } as HTMLImageElement, { x: 0.5, y: 0.5 }, 1, 0, 0);
    expect(recorder.calls('drawImage')).toHaveLength(0);
  });

  it('draws the sprite pixelated around the origin ratio', () => {
    const recorder = createCanvasRecorder();
    drawWeaponSpriteLayer(recorder.ctx, { width: 100, height: 50 } as HTMLImageElement, { x: 0.5, y: 0.25 }, 2, 0, 0);
    expect(recorder.calls('drawImage')).toHaveLength(1);
    expect(recorder.calls('drawImage')[0]!.args.slice(-4)).toEqual([-100, -25, 200, 100]);
    expect(recorder.calls('rotate')[0]!.args[0]).toBeCloseTo(Math.PI / 2);
  });

  it('labels barrels with their index', () => {
    const recorder = createCanvasRecorder();
    drawBarrelVisual(recorder.ctx, { angle: 90, index: 3, point, style: barrelStyle(palette, true, false, false) });
    expect(recorder.calls('fillText')[0]!.args[0]).toBe('4');
    expect(recorder.calls('strokeText')[0]!.args[0]).toBe('4');
    expect(recorder.calls('fillText')[0]!.alpha).toBe(1);
  });

  it.each([
    [{ selected: false }, 0.5],
    [{ selected: true }, 0.8],
    [{ selected: false, hovered: true }, 0.8],
    [{ selected: false, mirrored: true }, 0.8],
  ] as const)('uses the reference opacity for barrel state %j', (state, alpha) => {
    const recorder = createCanvasRecorder();
    drawBarrelVisual(recorder.ctx, {
      angle: 0,
      index: 0,
      point,
      style: barrelStyle(palette, state.selected, 'hovered' in state && state.hovered, 'mirrored' in state && state.mirrored),
    });
    expect(recorder.calls('stroke')[0]!.alpha).toBe(alpha);
    expect(recorder.calls('fill')[0]!.alpha).toBe(alpha);
    expect(recorder.calls('fillText')[0]!.alpha).toBe(1);
    expect(recorder.calls('lineTo')[0]!.args).toEqual([point.x + 36, point.y]);
  });

  it('draws twelve tinted glow layers and three additive core layers with scaled jitter', () => {
    const recorder = createCanvasRecorder();
    const image = { width: 100, height: 50 } as HTMLImageElement;
    const tinted = { width: 100, height: 50 } as HTMLCanvasElement;
    drawWeaponGlow(
      recorder.ctx,
      image,
      tinted,
      { tintAlpha: 128 / 1275, coreAlpha: 128 / 1020, origin: { x: 0.5, y: 0.5 }, center: point, scale: 2 },
      () => 0,
    );
    const draws = recorder.calls('drawImage');
    expect(draws).toHaveLength(15);
    expect(
      draws.slice(0, 12).every((entry) => entry.args[0] === tinted && entry.alpha === 128 / 1275 && entry.composite === 'source-over'),
    ).toBe(true);
    expect(draws.slice(12).every((entry) => entry.args[0] === image && entry.alpha === 128 / 1020 && entry.composite === 'lighter')).toBe(
      true,
    );
    expect(recorder.calls('translate')[0]!.args).toEqual([point.x - 2, point.y - 2]);
    expect(recorder.calls('translate')[12]!.args).toEqual([point.x - 1, point.y - 1]);
    expect(recorder.ctx.globalAlpha).toBe(1);
    expect(recorder.ctx.globalCompositeOperation).toBe('source-over');
  });
});
