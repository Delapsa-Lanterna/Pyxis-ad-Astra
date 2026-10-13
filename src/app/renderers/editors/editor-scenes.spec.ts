import { describe, expect, it } from 'vitest';
import { createCanvasRecorder } from '@/test/canvas-recorder';
import { createCanvasPalette } from '@/domain/editors/lib/canvas-palette';
import { createThemeColors } from '@/domain/settings/theme';
import { renderCanvasCursor, type CanvasScene } from './canvas-scene';
import { renderShipScene, type ShipScene } from './ship-scene';
import { renderWeaponScene, type WeaponScene } from './weapon-scene';
import { renderWeaponImages } from './weapon-images';

function canvasScene(): CanvasScene {
  return {
    width: 500,
    height: 500,
    center: { x: 250, y: 250 },
    scale: 1,
    palette: createCanvasPalette(createThemeColors('#2563eb', 'light')),
    mirrorY: null,
    cursor: null,
  };
}

function shipScene(): ShipScene {
  return {
    base: canvasScene(),
    ship: { collisionRadius: 40, shieldRadius: 30 },
    mode: 'overview',
    bounds: [-20, -20, 20, -20, 20, 20],
    center: [0, 0],
    shieldCenter: [0, 0],
    slots: [],
    engines: [],
    selected: null,
    selectedPort: null,
    hovered: null,
    dragKind: null,
    preview: null,
    mirrorMode: false,
    selectedSlot: null,
    selectedEngine: null,
    slotLoc: [0, 0],
    engineLoc: [0, 0],
    sprite: null,
    tintedSprite: null,
  };
}

describe('editor scene rendering', () => {
  it.each(['overview', 'ranges', 'bounds', 'weapon', 'launchBay', 'engine'] as const)('chooses the ship resource for %s mode', (mode) => {
    const recording = createCanvasRecorder();
    const sprite = { width: 100, height: 80 } as HTMLImageElement;
    const tintedSprite = { width: 100, height: 80 } as HTMLCanvasElement;
    renderShipScene(recording.ctx, { ...shipScene(), mode, sprite, tintedSprite });
    const draw = recording.calls('drawImage')[0]!;
    expect(draw.args[0]).toBe(mode === 'weapon' || mode === 'launchBay' ? tintedSprite : sprite);
    expect(draw.alpha).toBe(1);
  });

  it.each(['turret', 'hardpoint'] as const)('renders the current %s resources in their hinted order before glow', (mode) => {
    const base = canvasScene();
    const under = { width: 20, height: 40 } as HTMLImageElement;
    const body = { width: 30, height: 50 } as HTMLImageElement;
    const gun = { width: 10, height: 60 } as HTMLImageElement;
    const glow = { width: 30, height: 50 } as HTMLImageElement;
    const tint = { width: 30, height: 50 } as HTMLCanvasElement;
    const images = new Map([
      [mode + 'UnderSprite', under],
      [mode + 'Sprite', body],
      [mode + 'GunSprite', gun],
      [mode + 'GlowSprite', glow],
    ]);
    for (const below of [false, true]) {
      const recording = createCanvasRecorder();
      renderWeaponImages(recording.ctx, {
        images,
        weapon: { renderHints: below ? ['RENDER_BARREL_BELOW'] : [] },
        mode,
        scale: 2,
        center: base.center,
        glowTint: tint,
        glowColor: [100, 200, 50, 128],
      });
      const draws = recording.calls('drawImage');
      expect(draws.slice(0, 3).map((draw) => draw.args[0])).toEqual(below ? [under, gun, body] : [under, body, gun]);
      expect(draws.slice(0, 3).every((draw) => draw.alpha === 1)).toBe(true);
      expect(draws.slice(3, 15).every((draw) => draw.args[0] === tint && draw.alpha === 128 / 1275)).toBe(true);
      expect(draws.slice(15).every((draw) => draw.args[0] === glow && draw.alpha === 128 / 1020)).toBe(true);
    }
  });

  it.each([
    { selected: null, hovered: null, mirrorMode: false, expected: [0.5, 0.5] },
    { selected: 0, hovered: null, mirrorMode: false, expected: [0.8, 0.5] },
    { selected: null, hovered: { kind: 'barrel', i: 0 }, mirrorMode: false, expected: [0.8, 0.5] },
    { selected: 0, hovered: null, mirrorMode: true, expected: [0.8, 0.8] },
  ])('renders selected, hovered and mirrored barrels with their final styles: %j', ({ expected, ...selection }) => {
    const recording = createCanvasRecorder(),
      base = canvasScene();
    renderWeaponScene(recording.ctx, {
      base,
      assets: {
        images: new Map(),
        weapon: {},
        mode: 'turret',
        scale: 1,
        center: base.center,
        glowTint: null,
        glowColor: [255, 255, 255, 255],
      },
      ...selection,
      offsets: [-10, 0, 10, 0],
      angles: [0, 0],
      preview: null,
    });
    expect(recording.calls('fill').map((op) => op.alpha)).toEqual(expected);
    expect(recording.calls('fillText').map((op) => [op.args[0], op.alpha])).toEqual([
      ['1', 1],
      ['2', 1],
    ]);
  });

  it('paints the ship radius fills before its bounds', () => {
    const recording = createCanvasRecorder();
    renderShipScene(recording.ctx, shipScene());
    const fills = recording.ops
      .map((op, index) => ({ op, index }))
      .filter(({ op }) => op.op === 'fill' && String(op.args[0]).startsWith('rgba('));
    const bounds = recording.ops.findIndex((op) => op.op === 'closePath');
    expect(fills).toHaveLength(2);
    expect(fills.every(({ index }) => index < bounds)).toBe(true);
    expect(recording.calls('stroke').some((op) => op.args[0] === '#ffffff' && op.args[1] === 2)).toBe(true);
  });

  it('preserves the effective slot and engine ghost opacities', () => {
    const slot = createCanvasRecorder(),
      engine = createCanvasRecorder();
    renderShipScene(slot.ctx, {
      ...shipScene(),
      mode: 'weapon',
      bounds: [],
      preview: {
        kind: 'weaponCopy',
        coord: [0, 0],
        slot: { type: 'BALLISTIC', size: 'SMALL', mount: 'TURRET' },
      },
    });
    renderShipScene(engine.ctx, {
      ...shipScene(),
      mode: 'engine',
      bounds: [],
      preview: {
        kind: 'engineCopy',
        coord: [0, 0],
        engine: { angle: 180, length: 30, width: 10 },
      },
    });
    expect(slot.calls('fill').at(-1)!.alpha).toBe(1);
    expect(engine.calls('fill').every((op) => op.alpha === 0.55)).toBe(true);
  });

  it('paints the weapon ghost with its final marker opacity and an opaque number', () => {
    const recording = createCanvasRecorder(),
      base = canvasScene();
    const scene: WeaponScene = {
      base,
      assets: {
        images: new Map(),
        weapon: {},
        mode: 'turret',
        scale: 1,
        center: base.center,
        glowTint: null,
        glowColor: [255, 255, 255, 255],
      },
      mirrorMode: false,
      selected: null,
      hovered: null,
      offsets: [],
      angles: [],
      preview: { kind: 'add', coord: { x: 0, y: 0 } },
    };
    renderWeaponScene(recording.ctx, scene);
    expect(recording.calls('fill').at(-1)!.alpha).toBe(0.8);
    expect(recording.calls('fillText').at(-1)!.alpha).toBe(1);
    expect(recording.calls('fillText').at(-1)!.args[0]).toBe('1');
  });

  it('renders the cursor at sixteen pixels on each side of its supplied position', () => {
    const recording = createCanvasRecorder();
    renderCanvasCursor(recording.ctx, { ...canvasScene(), cursor: { point: { x: 50, y: 60 }, label: 'Position' } });
    expect(recording.calls('moveTo').map((op) => op.args)).toEqual([
      [34, 60],
      [50, 44],
    ]);
    expect(recording.calls('lineTo').map((op) => op.args)).toEqual([
      [66, 60],
      [50, 76],
    ]);
  });
});
