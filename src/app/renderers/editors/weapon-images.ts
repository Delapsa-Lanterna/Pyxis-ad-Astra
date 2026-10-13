import type { Point } from '@/domain/editors/editor-types';
import type { RowData } from '@/shared/types';
import { weaponSpriteDrawOrder, WEAPON_SPRITE_ORIGIN_RATIO, type WeaponViewMode } from '@/domain/editors/lib/weapon-sprite-fields';
import { drawWeaponGlow, drawWeaponSpriteLayer } from './canvas-visuals';
export interface WeaponImageScene {
  images: ReadonlyMap<string, HTMLImageElement>;
  weapon: RowData;
  mode: WeaponViewMode;
  scale: number;
  center: Point;
  glowTint: HTMLCanvasElement | null;
  glowColor: number[];
}
export function renderWeaponImages(ctx: CanvasRenderingContext2D, scene: WeaponImageScene): void {
  ctx.save();
  ctx.globalAlpha = 1;
  const origin = WEAPON_SPRITE_ORIGIN_RATIO[scene.mode];
  for (const field of weaponSpriteDrawOrder(scene.weapon, scene.mode)) {
    const image = scene.images.get(field);
    if (image) drawWeaponSpriteLayer(ctx, image, origin, scene.scale, scene.center.x, scene.center.y);
  }
  const glow = scene.images.get(scene.mode === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite');
  if (glow && scene.glowTint)
    drawWeaponGlow(ctx, glow, scene.glowTint, {
      tintAlpha: scene.glowColor[3]! / 1275,
      coreAlpha: scene.glowColor[3]! / 1020,
      origin,
      center: scene.center,
      scale: scene.scale,
    });
  ctx.restore();
}
