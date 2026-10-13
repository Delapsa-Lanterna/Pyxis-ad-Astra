import type { ShipEditorMode, ShipHoverPreview } from '@/domain/editors/editor-types';
import { centerMarkerStyle, weaponSlotStyle, launchBayPortStyle, engineStyle } from './canvas-styles';
import type { ShipGeometry } from '@/domain/editors/ship-editing';
import type { EditorTarget } from '@/domain/editors/editor-types';

import { bayPorts } from '@/domain/editors/lib/ship-slots';
import { shipCanvasPoint, shipRelativeToAbsolute } from '@/domain/editors/lib/geometry';
import { mirrorAngleDeg, mirrorOffsetPoint, mirrorBayPort, MIRROR_EPSILON } from '@/domain/editors/lib/mirror';
import {
  drawCrossMarker,
  drawEngineVisual,
  drawLaunchBayPortVisual,
  drawRadiusField,
  drawRadiusFill,
  drawWeaponSlotVisual,
  drawXMarker,
} from './canvas-visuals';
import { drawPixelImage } from './canvas-drawing';
import { renderCanvasBounds, renderCanvasBase, renderCanvasCursor, type CanvasScene } from './canvas-scene';
import { renderMountedWeapons, type MountedWeaponScene } from './weapon-images';

export interface ShipScene {
  base: CanvasScene;
  geometry: ShipGeometry;
  interaction: {
    mode: ShipEditorMode;
    target: EditorTarget | null;
    hovered: EditorTarget | null;
    dragKind: string | null;
    preview: ShipHoverPreview;
    mirror: boolean;
  };
  resources: { sprite: HTMLImageElement | null; tintedSprite: HTMLCanvasElement | null };
  weapons: { items: MountedWeaponScene['weapons']; image: MountedWeaponScene['image'] };
}
function shipToCanvas(scene: ShipScene, loc: number[]) {
  return shipCanvasPoint(loc, scene.base.center, scene.base.scale);
}
function shipCenterPoint(scene: ShipScene) {
  return shipToCanvas(scene, scene.geometry.center);
}
function relativeToCanvas(scene: ShipScene, loc: number[]) {
  return shipToCanvas(scene, shipRelativeToAbsolute(loc, scene.geometry.center));
}

function renderPreviewBounds(ctx: CanvasRenderingContext2D, scene: ShipScene, preview: NonNullable<ShipHoverPreview>) {
  if (preview.kind !== 'boundAppend' && preview.kind !== 'boundInsert') return;
  const points = [];
  for (let i = 0; i < scene.geometry.bounds.length; i += 2) points.push([scene.geometry.bounds[i] ?? 0, scene.geometry.bounds[i + 1] ?? 0]);
  if (preview.kind === 'boundAppend') {
    points.push(preview.coord);
    if (scene.interaction.mirror && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) points.push(mirrorOffsetPoint(preview.coord));
  } else {
    points.splice(preview.insertAfter + 1, 0, preview.coord);
    if (scene.interaction.mirror && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON)
      points.splice(preview.insertAfter + 2, 0, mirrorOffsetPoint(preview.coord));
  }
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  renderCanvasBounds(
    ctx,
    scene.base.palette,
    points.map((point) => relativeToCanvas(scene, point)),
    points.length - 1,
    points.length - 1,
  );
  ctx.restore();
}
function renderPreview(ctx: CanvasRenderingContext2D, scene: ShipScene, preview: NonNullable<ShipHoverPreview>) {
  ctx.save();
  ctx.globalAlpha = 1;
  if (preview.kind === 'collisionRadius') {
    drawRadiusField(
      ctx,
      shipCenterPoint(scene),
      preview.radius * scene.base.scale,
      'rgba(240, 230, 140, 0.15)',
      centerMarkerStyle(scene.base.palette, false, true),
    );
  }
  if (preview.kind === 'shieldRadius') {
    drawRadiusField(
      ctx,
      relativeToCanvas(scene, scene.geometry.shieldCenter),
      preview.radius * scene.base.scale,
      'rgba(175, 215, 230, 0.15)',
      centerMarkerStyle(scene.base.palette, false, true),
      'x',
    );
  }
  if (preview.kind === 'weaponCopy' || preview.kind === 'weaponMove' || preview.kind === 'launchBayAdd') {
    drawWeaponSlotVisual(ctx, {
      angle: preview.slot.angle,
      arc: preview.slot.arc,
      mount: preview.slot.mount,
      point: relativeToCanvas(scene, preview.coord),
      size: preview.slot.size,
      type: preview.slot.type,
      style: weaponSlotStyle(preview.slot.type, 1),
    });
    if (scene.interaction.mirror && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawWeaponSlotVisual(ctx, {
        angle: mirrorAngleDeg(preview.slot.angle),
        arc: preview.slot.arc,
        mount: preview.slot.mount,
        point: relativeToCanvas(scene, mirrorOffsetPoint(preview.coord)),
        size: preview.slot.size,
        type: preview.slot.type,
        style: weaponSlotStyle(preview.slot.type, 1),
      });
    }
  }
  if (preview.kind === 'launchBayPortAdd') {
    drawLaunchBayPortVisual(ctx, { point: relativeToCanvas(scene, preview.coord), style: launchBayPortStyle(1, false, false) });
    if (scene.interaction.mirror && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawLaunchBayPortVisual(ctx, {
        point: relativeToCanvas(scene, mirrorBayPort(preview.coord)),
        style: launchBayPortStyle(1, false, false),
      });
    }
  }
  if (preview.kind === 'weaponArc' && scene.geometry.slots[scene.interaction.target!.i]) {
    drawWeaponSlotVisual(ctx, {
      angle: scene.geometry.slots[scene.interaction.target!.i]!.angle,
      arc: preview.arc,
      mount: scene.geometry.slots[scene.interaction.target!.i]!.mount,
      point: relativeToCanvas(scene, scene.geometry.slots[scene.interaction.target!.i]!.locations),
      size: scene.geometry.slots[scene.interaction.target!.i]!.size,
      type: scene.geometry.slots[scene.interaction.target!.i]!.type,
      style: weaponSlotStyle(scene.geometry.slots[scene.interaction.target!.i]!.type, 1),
    });
  }
  if (preview.kind === 'engineCopy' || preview.kind === 'engineMove') {
    drawEngineVisual(ctx, {
      angle: preview.engine.angle,
      length: preview.engine.length,
      point: relativeToCanvas(scene, preview.coord),
      scale: scene.base.scale,
      width: preview.engine.width,
      style: engineStyle(scene.base.palette, 0.55, true, true),
    });
    if (scene.interaction.mirror && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawEngineVisual(ctx, {
        angle: mirrorAngleDeg(preview.engine.angle),
        length: preview.engine.length,
        point: relativeToCanvas(scene, mirrorOffsetPoint(preview.coord)),
        scale: scene.base.scale,
        width: preview.engine.width,
        style: engineStyle(scene.base.palette, 0.55, true, true),
      });
    }
  }

  if (preview.kind === 'engineSize' && scene.geometry.engines[scene.interaction.target!.i]) {
    drawEngineVisual(ctx, {
      angle: scene.geometry.engines[scene.interaction.target!.i]!.angle,
      length: preview.length,
      point: relativeToCanvas(scene, scene.geometry.engines[scene.interaction.target!.i]!.location),
      scale: scene.base.scale,
      width: preview.width,
      style: engineStyle(scene.base.palette, 0.55, true, true),
    });
  }
  ctx.restore();
  renderPreviewBounds(ctx, scene, preview);
}
export function renderShipScene(ctx: CanvasRenderingContext2D, scene: ShipScene): void {
  renderCanvasBase(ctx, scene.base);
  if (scene.resources.sprite) {
    const bottomLeft = shipToCanvas(scene, [0, 0]);
    const drawWidth = scene.resources.sprite.height * scene.base.scale;
    ctx.save();
    ctx.translate(bottomLeft.x + drawWidth, bottomLeft.y);
    ctx.rotate(Math.PI / 2);
    const sprite =
      (scene.interaction.mode === 'weapon' || scene.interaction.mode === 'launchBay' ? scene.resources.tintedSprite : null) ??
      scene.resources.sprite;
    drawPixelImage(ctx, sprite, 0, 0, scene.resources.sprite.width * scene.base.scale, scene.resources.sprite.height * scene.base.scale);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // Ship.render combat order; refit grouping belongs to the immersive scene.
  renderMountedWeapons(ctx, {
    weapons: scene.weapons.items,
    image: scene.weapons.image,
    point: (slot) => relativeToCanvas(scene, slot.locations as number[]),
    rotation: (slot) => ((90 - Number(slot.angle ?? 0)) * Math.PI) / 180,
    scale: scene.base.scale,
    context: 'combat',
    renderModules: () => {},
  });
  if (scene.interaction.mode === 'ranges' || scene.interaction.mode === 'overview') {
    const sp = relativeToCanvas(scene, scene.geometry.shieldCenter);
    const cp = shipCenterPoint(scene);
    drawRadiusFill(ctx, cp, scene.geometry.collisionRadius * scene.base.scale, 'rgba(240, 230, 140, 0.15)');
    drawRadiusFill(ctx, sp, scene.geometry.shieldRadius * scene.base.scale, 'rgba(175, 215, 230, 0.15)');
    drawCrossMarker(
      ctx,
      cp,
      centerMarkerStyle(scene.base.palette, scene.interaction.dragKind === 'center', scene.interaction.hovered?.kind === 'center'),
    );
    drawXMarker(
      ctx,
      sp,
      centerMarkerStyle(scene.base.palette, scene.interaction.dragKind === 'shield', scene.interaction.hovered?.kind === 'shield'),
    );
  }
  if (scene.geometry.bounds.length >= 4 && (scene.interaction.mode === 'bounds' || scene.interaction.mode === 'overview')) {
    const points = [];
    for (let i = 0; i < scene.geometry.bounds.length; i += 2)
      points.push(relativeToCanvas(scene, [scene.geometry.bounds[i] ?? 0, scene.geometry.bounds[i + 1] ?? 0]));
    renderCanvasBounds(
      ctx,
      scene.base.palette,
      points,
      scene.interaction.mode === 'bounds' ? (scene.interaction.target?.i ?? null) : null,
      scene.interaction.mode === 'bounds' && scene.interaction.hovered?.kind === 'bound' ? scene.interaction.hovered.i : null,
    );
  }
  if (scene.interaction.mode === 'weapon' || scene.interaction.mode === 'launchBay' || scene.interaction.mode === 'overview')
    scene.geometry.slots.forEach((slot, i) => {
      const isLaunchBay = slot.type.toUpperCase() === 'LAUNCH_BAY';
      if (scene.interaction.mode === 'weapon' && isLaunchBay) return;
      if (scene.interaction.mode === 'launchBay' && !isLaunchBay) return;
      if (scene.interaction.preview?.kind === 'weaponMove' && scene.interaction.mode === 'weapon' && i === scene.interaction.target?.i)
        return;
      if (isLaunchBay) {
        const baySelected = scene.interaction.target?.i === i;
        bayPorts(slot.locations).forEach((port, portIndex) => {
          const hovered =
            scene.interaction.hovered?.kind === 'launchBayPort' &&
            scene.interaction.hovered.i === i &&
            scene.interaction.hovered.port === portIndex;
          const accent = baySelected && scene.interaction.target?.port === portIndex;
          drawLaunchBayPortVisual(ctx, {
            point: relativeToCanvas(scene, port),
            style: launchBayPortStyle(hovered || baySelected ? 1 : 0.65, hovered, accent),
          });
        });
        return;
      }
      drawWeaponSlotVisual(ctx, {
        angle: slot.angle,
        arc: slot.arc,
        mount: slot.mount,
        point: relativeToCanvas(scene, slot.locations),
        size: slot.size,
        type: slot.type,
        style: weaponSlotStyle(
          slot.type,
          (scene.interaction.mode === 'weapon' || scene.interaction.mode === 'launchBay') && i === scene.interaction.target?.i ? 1 : 0.6,
        ),
      });
    });
  if (scene.interaction.mode === 'engine' || scene.interaction.mode === 'overview')
    scene.geometry.engines.forEach((eng, i) => {
      if (scene.interaction.preview?.kind === 'engineMove' && scene.interaction.mode === 'engine' && i === scene.interaction.target?.i)
        return;
      drawEngineVisual(ctx, {
        angle: eng.angle,
        length: eng.length,
        point: relativeToCanvas(scene, eng.location),
        scale: scene.base.scale,
        width: eng.width,
        style: engineStyle(
          scene.base.palette,
          1,
          scene.interaction.mode === 'engine' && i === scene.interaction.target?.i,
          scene.interaction.mode === 'engine' && scene.interaction.hovered?.kind === 'engine' && scene.interaction.hovered.i === i,
        ),
      });
    });
  if (scene.interaction.preview) renderPreview(ctx, scene, scene.interaction.preview);
  renderCanvasCursor(ctx, scene.base);
}
