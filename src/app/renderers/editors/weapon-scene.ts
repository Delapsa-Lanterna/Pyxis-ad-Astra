import type { BarrelPreview } from '@/domain/editors/editor-types';
import { centerMarkerStyle, barrelStyle } from './canvas-styles';
import type { CanvasTargetIdentity } from '@/app/composables/canvas/use-canvas-editor';
import { findMirrorBarrelIndex, mirrorLateral, MIRROR_EPSILON } from '@/domain/editors/lib/mirror';
import { drawBarrelVisual, drawCrossMarker } from './canvas-visuals';
import { renderCanvasBase, renderCanvasCursor, type CanvasScene } from './canvas-scene';
import { renderWeaponImages, type WeaponImageScene } from './weapon-images';

export interface WeaponScene {
  base: CanvasScene;
  assets: WeaponImageScene;
  mirrorMode: boolean;
  selected: number | null;
  hovered: CanvasTargetIdentity | null;
  offsets: number[];
  angles: number[];
  preview: BarrelPreview;
}
function toWeaponCanvas(scene: WeaponScene, x: number, y: number) {
  return { x: scene.base.center.x + x * scene.base.scale, y: scene.base.center.y - y * scene.base.scale };
}
function renderPreview(ctx: CanvasRenderingContext2D, scene: WeaponScene, preview: NonNullable<BarrelPreview>) {
  ctx.save();
  if (preview.kind === 'add') {
    drawBarrelVisual(ctx, {
      angle: 0,
      index: scene.offsets.length / 2,
      point: toWeaponCanvas(scene, preview.coord.x, preview.coord.y),
      style: barrelStyle(scene.base.palette, true, true, false),
    });
    if (scene.mirrorMode && Math.abs(preview.coord.x) > MIRROR_EPSILON) {
      drawBarrelVisual(ctx, {
        angle: 0,
        index: scene.offsets.length / 2 + 1,
        point: toWeaponCanvas(scene, mirrorLateral(preview.coord.x), preview.coord.y),
        style: barrelStyle(scene.base.palette, true, true, false),
      });
    }
  }
  if (preview.kind === 'angle' && scene.selected !== null) {
    drawBarrelVisual(ctx, {
      angle: preview.angle,
      index: scene.selected,
      point: toWeaponCanvas(scene, scene.offsets[scene.selected * 2] || 0, scene.offsets[scene.selected * 2 + 1] || 0),
      style: barrelStyle(scene.base.palette, true, true, false),
    });
  }
  ctx.restore();
}
export function renderWeaponScene(ctx: CanvasRenderingContext2D, scene: WeaponScene): void {
  renderCanvasBase(ctx, scene.base);
  renderWeaponImages(ctx, scene.assets);
  ctx.globalAlpha = 1;
  drawCrossMarker(ctx, scene.base.center, centerMarkerStyle(scene.base.palette, false, false));
  const target = scene.selected ?? (scene.hovered?.kind === 'barrel' ? scene.hovered.i : null);
  const twin = scene.mirrorMode && target !== null ? findMirrorBarrelIndex(scene.offsets, target) : null;
  for (let i = 0; i < scene.offsets.length / 2; i++) {
    drawBarrelVisual(ctx, {
      angle: scene.angles[i] || 0,
      index: i,
      point: toWeaponCanvas(scene, scene.offsets[i * 2] || 0, scene.offsets[i * 2 + 1] || 0),
      style: barrelStyle(scene.base.palette, scene.selected === i, scene.hovered?.kind === 'barrel' && scene.hovered.i === i, twin === i),
    });
  }
  if (scene.preview) renderPreview(ctx, scene, scene.preview);
  renderCanvasCursor(ctx, scene.base);
}
