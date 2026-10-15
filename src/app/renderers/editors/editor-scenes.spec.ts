import { createWeaponFirePreviewParams } from '@/domain/weapon-fire-preview/simulation';
import { renderWeaponFirePreviewScene, type WeaponFirePreviewScene } from '../weapon-fire-preview/scene';
import { describe, expect, it, vi } from 'vitest';
import { createCanvasRecorder } from '@/test/canvas-recorder';
import { createCanvasPalette } from '@/domain/editors/lib/canvas-palette';
import { createThemeColors } from '@/domain/settings/theme';
import { renderCanvasCursor, type CanvasScene } from './canvas-scene';
import { renderSpecShipEditorScene, type SpecShipEditorScene } from '../spec-editor/ship/spec-ship-scene';
import { renderSpecWeaponEditorScene, type SpecWeaponEditorScene } from '../spec-editor/weapon/spec-weapon-scene';
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

function shipScene(): SpecShipEditorScene {
  return {
    base: canvasScene(),
    geometry: {
      collisionRadius: 40,
      shieldRadius: 30,
      bounds: [-20, -20, 20, -20, 20, 20],
      center: [0, 0],
      shieldCenter: [0, 0],
      slots: [],
      engines: [],
    },
    interaction: { mode: 'overview', target: null, hovered: null, dragKind: null, preview: null, mirror: false },
    resources: { sprite: null, tintedSprite: null },
    weapons: { items: [], image: () => undefined },
  };
}

describe('editor scene rendering', () => {
  it.each([
    ['projectile', 'lighter'],
    ['beam', 'lighter'],
    ['pulse', 'source-over'],
  ] as const)('uses the %s static blend', (specClass, composite) => {
    const recording = createCanvasRecorder(),
      bitmap = { width: 20, height: 40 } as HTMLImageElement;
    renderWeaponImages(recording.ctx, {
      images: new Map([['turretSprite', bitmap]]),
      weapon: { specClass, renderHints: ['RENDER_ADDITIVE'] },
      mode: 'turret',
      scale: 1,
      center: { x: 0, y: 0 },
      glowTint: null,
      glowColor: [0, 0, 0, 0],
    });
    expect(recording.calls('drawImage')[0]!.composite).toBe(composite);
    expect(recording.ctx.globalCompositeOperation).toBe('source-over');
  });
  it('keeps grid and range strokes at one pixel across frames with missile trails', () => {
    const recording = createCanvasRecorder(),
      base = canvasScene(),
      params = createWeaponFirePreviewParams({}, { specClass: 'projectile' }, { specClass: 'missile' }, 'turret');
    const scene: WeaponFirePreviewScene = {
      size: { width: 500, height: 500 },
      palette: base.palette,
      params,
      origin: { x: 80, y: 250 },
      range: 300,
      scale: 1,
      hasWeaponSpec: true,
      assets: {
        images: new Map(),
        weapon: {},
        mode: 'turret',
        scale: 1,
        center: { x: 80, y: 250 },
        glowTint: null,
        glowColor: [255, 255, 255, 255],
      },
      barrels: [],
      beam: { alpha: 0, length: 0, offset: 0, phase: 'idle', timer: 0 },
      projectiles: [
        {
          x: 100,
          y: 250,
          angle: 0,
          speed: 20,
          age: 1,
          trail: [
            { x: 90, y: 250 },
            { x: 100, y: 250 },
          ],
          exploding: false,
          explosionAge: 0,
          missile: true,
        },
      ],
    };
    renderWeaponFirePreviewScene(recording.ctx, scene);
    renderWeaponFirePreviewScene(recording.ctx, scene);
    expect(
      recording
        .calls('stroke')
        .filter((x) => x.args[0] === base.palette.grid || x.args[0] === '#ef444488')
        .every((x) => x.args[1] === 1),
    ).toBe(true);
    expect(
      recording
        .calls('stroke')
        .filter((x) => x.args[0] === '#f59e0b66')
        .map((x) => x.args[1]),
    ).toEqual([3, 3]);
  });

  it.each(['overview', 'ranges', 'bounds', 'weapon', 'launchBay', 'engine'] as const)('chooses the ship resource for %s mode', (mode) => {
    const recording = createCanvasRecorder();
    const sprite = { width: 100, height: 80 } as HTMLImageElement;
    const tintedSprite = { width: 100, height: 80 } as HTMLCanvasElement;
    renderSpecShipEditorScene(recording.ctx, {
      ...shipScene(),
      interaction: { ...shipScene().interaction, mode },
      resources: { sprite, tintedSprite },
    });
    const draw = recording.calls('drawImage')[0]!;
    expect(draw.args[0]).toBe(mode === 'weapon' || mode === 'launchBay' ? tintedSprite : sprite);
    expect(draw.alpha).toBe(1);
  });

  it.each(['overview', 'ranges', 'bounds', 'weapon', 'launchBay', 'engine'] as const)(
    'places built-in equipment above the hull in %s mode',
    (mode) => {
      const recording = createCanvasRecorder(),
        sprite = { width: 100, height: 80 } as HTMLImageElement;
      const bitmap = { width: 20, height: 40 } as HTMLImageElement;
      const resource = {
        source: 'core' as const,
        ownerKind: 'weapon' as const,
        ownerId: 'gun',
        relPath: 'graphics/gun.png',
        key: 'turretSprite',
      };
      renderSpecShipEditorScene(recording.ctx, {
        ...shipScene(),
        interaction: { ...shipScene().interaction, mode },
        resources: { sprite, tintedSprite: null },
        weapons: {
          items: [
            {
              slot: { id: 'A', locations: [10, 20], angle: 30, mount: 'TURRET' },
              renderOrder: 20,
              layers: [{ resource, origin: { x: 0.5, y: 0.5 }, phase: 'body' }],
              loadedMissile: null,
              additive: false,
            },
          ],
          image: () => bitmap,
        },
      });
      expect(recording.calls('drawImage').map((op) => op.args[0])).toEqual([sprite, bitmap]);
      expect(recording.calls('translate').map((op) => op.args)).toContainEqual([260, 230]);
      expect(recording.calls('rotate').map((op) => op.args[0])).toContain((60 * Math.PI) / 180);
    },
  );

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
        weapon: { specClass: 'projectile', visualRecoil: 1, renderHints: below ? ['RENDER_BARREL_BELOW'] : [] },
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

  it.each(['turret', 'hardpoint'] as const)('keeps the %s base visible when glow is hidden or transparent', (mode) => {
    const body = { width: 20, height: 40 } as HTMLImageElement;
    const glow = { width: 20, height: 40 } as HTMLImageElement;
    const tint = { width: 20, height: 40 } as HTMLCanvasElement;
    for (const state of [
      { alpha: 0, tint },
      { alpha: 128, tint: null },
    ]) {
      const recording = createCanvasRecorder();
      const random = vi.fn(() => 0.5);
      renderWeaponImages(
        recording.ctx,
        {
          images: new Map([
            [mode + 'Sprite', body],
            [mode + 'GlowSprite', glow],
          ]),
          weapon: {},
          mode,
          scale: 1,
          center: canvasScene().center,
          glowTint: state.tint,
          glowColor: [100, 200, 50, state.alpha],
        },
        random,
      );
      expect(recording.calls('drawImage').map((draw) => [draw.args[0], draw.alpha])).toEqual([[body, 1]]);
      expect(random).toHaveBeenCalledTimes(0);
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
    renderSpecWeaponEditorScene(recording.ctx, {
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
      offsets: [10, -10, 10, 10],
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
    renderSpecShipEditorScene(recording.ctx, shipScene());
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
    renderSpecShipEditorScene(slot.ctx, {
      ...shipScene(),
      geometry: { ...shipScene().geometry, bounds: [] },
      interaction: {
        ...shipScene().interaction,
        mode: 'weapon',
        preview: {
          kind: 'weaponCopy',
          coord: [0, 0],
          slot: { type: 'BALLISTIC', size: 'SMALL', mount: 'TURRET', angle: 0, arc: 0, locations: [0, 0] },
        },
      },
    });
    renderSpecShipEditorScene(engine.ctx, {
      ...shipScene(),
      geometry: { ...shipScene().geometry, bounds: [] },
      interaction: {
        ...shipScene().interaction,
        mode: 'engine',
        preview: {
          kind: 'engineCopy',
          coord: [0, 0],
          engine: { angle: 180, length: 30, width: 10, location: [0, 0] },
        },
      },
    });
    expect(slot.calls('fill').at(-1)!.alpha).toBe(1);
    expect(engine.calls('fill').every((op) => op.alpha === 0.55)).toBe(true);
  });

  it('paints the weapon ghost with its final marker opacity and an opaque number', () => {
    const recording = createCanvasRecorder(),
      base = canvasScene();
    const scene: SpecWeaponEditorScene = {
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
    renderSpecWeaponEditorScene(recording.ctx, scene);
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
