import { describe, expect, it } from 'vitest';
import { createCanvasRecorder } from '@/test/unit/canvas-recorder';
import { WEAPON_COLORS } from '@/shared/lib/starsector';
import { drawWeaponSlotVisual, drawLaunchBayPortVisual, weaponSlotStyle, launchBayPortStyle } from './weapon-slot-renderer';

const point = { x: 10, y: 20 };

describe('drawWeaponSlotVisual', () => {
  it.each([false, true])('isolates refit layers and restores auxiliary styles for builtin=%s', (builtin) => {
    const recorder = createCanvasRecorder();
    recorder.ctx.globalAlpha = 0.4;
    const options = { angle: 0, arc: 120, mount: 'TURRET', point, size: 'LARGE', type: 'ENERGY', style: weaponSlotStyle('ENERGY', 0.6) };
    drawWeaponSlotVisual(recorder.ctx, options);
    const auxiliary = recorder.calls('stroke').slice(0, 3);
    const before = recorder.ops.length;
    drawWeaponSlotVisual(recorder.ctx, { ...options, refit: { scale: 2, highlighted: true, builtin } });
    const strokes = recorder.ops.slice(before).filter((call) => call.op === 'stroke');
    expect(strokes.slice(0, 3)).toEqual(auxiliary);
    expect(strokes.slice(3)).toHaveLength(9);
    expect(strokes.slice(3).map((call) => call.alpha)).toEqual(
      [1, 0.5, 0.25].flatMap((layer) => Array(3).fill(layer * (builtin ? 0.3 : 0.5))),
    );
    expect(recorder.calls('fill').at(-1)!.alpha).toBe(0.6);
    expect(recorder.ctx.globalAlpha).toBe(0.4);
    expect(recorder.ctx.globalCompositeOperation).toBe('source-over');
    recorder.ops.length = 0;
    drawWeaponSlotVisual(recorder.ctx, { ...options, showArc: false });
    expect(recorder.calls('rotate')).toHaveLength(0);
    expect(recorder.calls('stroke')).toHaveLength(3);
    expect(recorder.calls('fill')).toHaveLength(1);
  });
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
