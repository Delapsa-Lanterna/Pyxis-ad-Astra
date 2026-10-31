import type { Point } from '@/domain/editors/editor-types';
import type { DeepReadonly, RowData } from '@/shared/types';
import { weaponSpriteDrawOrder, WEAPON_SPRITE_ORIGIN_RATIO, type WeaponViewMode } from '@/shared/lib/starsector/weapon-sprite-fields';
import { drawWeaponGlow } from './canvas-visuals';
import { weaponAdditiveBlend, type MountedWeaponImages, type WeaponImageLayer } from '@/shared/lib/starsector/weapon-images';
import { sortMountedWeapons } from '@/shared/lib/starsector/weapon-render-order';
import { drawPixelImage } from './canvas-drawing';
export interface WeaponImageScene {
  images: ReadonlyMap<string, HTMLImageElement>;
  weapon: DeepReadonly<RowData>;
  mode: WeaponViewMode;
  scale: number;
  center: Point;
  glowTint: HTMLCanvasElement | null;
  glowColor: number[];
}
export function renderWeaponImages(ctx: CanvasRenderingContext2D, scene: WeaponImageScene, random = Math.random): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = weaponAdditiveBlend(scene.weapon) ? 'lighter' : 'source-over';
  const origin = WEAPON_SPRITE_ORIGIN_RATIO[scene.mode];
  for (const field of weaponSpriteDrawOrder(scene.weapon, scene.mode)) {
    const image = scene.images.get(field);
    if (image) renderWeaponImageLayer(ctx, image, origin, scene.center, Math.PI / 2, scene.scale);
  }
  const glow = scene.images.get(scene.mode === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite');
  if (glow && scene.glowTint && scene.glowColor[3]! > 0)
    drawWeaponGlow(
      ctx,
      glow,
      scene.glowTint,
      {
        tintAlpha: scene.glowColor[3]! / 1275,
        coreAlpha: scene.glowColor[3]! / 1020,
        origin,
        center: scene.center,
        scale: scene.scale,
      },
      random,
    );
  ctx.restore();
}

function renderWeaponImageLayer(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  origin: { x: number; y: number },
  point: Point,
  rotation: number,
  scale: number,
) {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(rotation);
  drawPixelImage(ctx, image, -image.width * origin.x * scale, -image.height * origin.y * scale, image.width * scale, image.height * scale);
  ctx.restore();
}

export interface MountedWeaponScene {
  weapons: readonly MountedWeaponImages[];
  image: (resource: WeaponImageLayer['resource']) => HTMLImageElement | undefined;
  point: (slot: MountedWeaponImages['slot']) => Point;
  rotation: (slot: MountedWeaponImages['slot']) => number;
  scale: number;
  context: 'combat' | 'refit';
  renderModules: () => void;
}

export function renderMountedWeapons(ctx: CanvasRenderingContext2D, scene: MountedWeaponScene): void {
  const weapons = sortMountedWeapons(scene.weapons);
  const paint = (weapon: MountedWeaponImages, phase: WeaponImageLayer['phase']) => {
    const point = scene.point(weapon.slot),
      rotation = scene.rotation(weapon.slot);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = weapon.additive ? 'lighter' : 'source-over';
    for (const layer of weapon.layers) {
      if (layer.phase !== phase) continue;
      const image = scene.image(layer.resource);
      if (image) renderWeaponImageLayer(ctx, image, layer.origin, point, rotation, scene.scale);
    }
    const missile = phase === 'body' ? weapon.loadedMissile : null;
    const bitmap = missile ? scene.image(missile.resource) : null;
    if (missile && bitmap) {
      ctx.translate(point.x, point.y);
      ctx.rotate(rotation);
      ctx.scale(scene.scale, scene.scale);
      for (let launch = 0; launch < missile.offsets.length / 2; launch++) {
        ctx.save();
        ctx.translate(-missile.offsets[launch * 2 + 1]!, -missile.offsets[launch * 2]!);
        ctx.rotate((-(missile.angles[launch] ?? 0) * Math.PI) / 180);
        drawPixelImage(ctx, bitmap, -missile.center[0], -(missile.size[1] - missile.center[1]), missile.size[0], missile.size[1]);
        ctx.restore();
      }
    }
    ctx.restore();
  };
  // Ship.render runs every renderUnder before any weapon body.
  for (const weapon of weapons) paint(weapon, 'under');
  if (scene.context === 'combat') {
    for (const weapon of weapons) paint(weapon, 'body');
  } else {
    // ShipDisplayPanel separates decorative bodies, child modules, then non-decorative bodies.
    for (const weapon of weapons) if (weapon.slot.type === 'DECORATIVE') paint(weapon, 'body');
    scene.renderModules();
    for (const weapon of weapons) if (weapon.slot.type !== 'DECORATIVE') paint(weapon, 'body');
  }
}
