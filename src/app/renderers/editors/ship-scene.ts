import type { ShipEditorMode, ShipHoverPreview } from '@/domain/editors/editor-types';
import { centerMarkerStyle, weaponSlotStyle, launchBayPortStyle, engineStyle } from './canvas-styles';
import type { RowData } from '@/shared/types';
import type { CanvasTargetIdentity } from '@/app/composables/canvas/use-canvas-editor';
import { arr, num, str } from '@/shared/lib/starsector';
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

export interface ShipScene {
  base: CanvasScene;
  ship: RowData;
  mode: ShipEditorMode;
  bounds: number[];
  center: number[];
  shieldCenter: number[];
  slots: RowData[];
  engines: RowData[];
  selected: number | null;
  selectedPort: number | null;
  hovered: CanvasTargetIdentity | null;
  dragKind: string | null;
  preview: ShipHoverPreview;
  mirrorMode: boolean;
  selectedSlot: RowData | null | undefined;
  selectedEngine: RowData | null | undefined;
  slotLoc: number[];
  engineLoc: number[];
  sprite: HTMLImageElement | null;
  tintedSprite: HTMLCanvasElement | null;
}
function shipToCanvas(scene: ShipScene, loc: number[]) {
  return shipCanvasPoint(loc, scene.base.center, scene.base.scale);
}
function shipCenterPoint(scene: ShipScene) {
  return shipToCanvas(scene, scene.center);
}
function relativeToCanvas(scene: ShipScene, loc: number[]) {
  return shipToCanvas(scene, shipRelativeToAbsolute(loc, scene.center));
}

function renderPreviewBounds(ctx: CanvasRenderingContext2D, scene: ShipScene, preview: NonNullable<ShipHoverPreview>) {
  if (preview.kind !== 'boundAppend' && preview.kind !== 'boundInsert') return;
  const points = [];
  for (let i = 0; i < scene.bounds.length; i += 2) points.push([scene.bounds[i] ?? 0, scene.bounds[i + 1] ?? 0]);
  if (preview.kind === 'boundAppend') {
    points.push(preview.coord);
    if (scene.mirrorMode && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) points.push(mirrorOffsetPoint(preview.coord));
  } else {
    points.splice(preview.insertAfter + 1, 0, preview.coord);
    if (scene.mirrorMode && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON)
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
      relativeToCanvas(scene, scene.shieldCenter),
      preview.radius * scene.base.scale,
      'rgba(175, 215, 230, 0.15)',
      centerMarkerStyle(scene.base.palette, false, true),
      'x',
    );
  }
  if (preview.kind === 'weaponCopy' || preview.kind === 'weaponMove' || preview.kind === 'launchBayAdd') {
    drawWeaponSlotVisual(ctx, {
      angle: num(preview.slot.angle, 0),
      arc: num(preview.slot.arc, 0),
      mount: str(preview.slot.mount),
      point: relativeToCanvas(scene, preview.coord),
      size: str(preview.slot.size, 'MEDIUM'),
      type: str(preview.slot.type, 'SYSTEM'),
      style: weaponSlotStyle(str(preview.slot.type, 'SYSTEM'), 1),
    });
    if (scene.mirrorMode && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawWeaponSlotVisual(ctx, {
        angle: mirrorAngleDeg(num(preview.slot.angle, 0)),
        arc: num(preview.slot.arc, 0),
        mount: str(preview.slot.mount),
        point: relativeToCanvas(scene, mirrorOffsetPoint(preview.coord)),
        size: str(preview.slot.size, 'MEDIUM'),
        type: str(preview.slot.type, 'SYSTEM'),
        style: weaponSlotStyle(str(preview.slot.type, 'SYSTEM'), 1),
      });
    }
  }
  if (preview.kind === 'launchBayPortAdd') {
    drawLaunchBayPortVisual(ctx, { point: relativeToCanvas(scene, preview.coord), style: launchBayPortStyle(1, false, false) });
    if (scene.mirrorMode && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawLaunchBayPortVisual(ctx, {
        point: relativeToCanvas(scene, mirrorBayPort(preview.coord)),
        style: launchBayPortStyle(1, false, false),
      });
    }
  }
  if (preview.kind === 'weaponArc' && scene.selectedSlot) {
    drawWeaponSlotVisual(ctx, {
      angle: num(scene.selectedSlot.angle, 0),
      arc: preview.arc,
      mount: str(scene.selectedSlot.mount),
      point: relativeToCanvas(scene, scene.slotLoc),
      size: str(scene.selectedSlot.size, 'MEDIUM'),
      type: str(scene.selectedSlot.type, 'SYSTEM'),
      style: weaponSlotStyle(str(scene.selectedSlot.type, 'SYSTEM'), 1),
    });
  }
  if (preview.kind === 'engineCopy' || preview.kind === 'engineMove') {
    drawEngineVisual(ctx, {
      angle: num(preview.engine.angle, 0),
      length: num(preview.engine.length, 20),
      point: relativeToCanvas(scene, preview.coord),
      scale: scene.base.scale,
      width: num(preview.engine.width, 10),
      style: engineStyle(scene.base.palette, 0.55, true, true),
    });
    if (scene.mirrorMode && Math.abs(preview.coord[1] || 0) > MIRROR_EPSILON) {
      drawEngineVisual(ctx, {
        angle: mirrorAngleDeg(num(preview.engine.angle, 0)),
        length: num(preview.engine.length, 20),
        point: relativeToCanvas(scene, mirrorOffsetPoint(preview.coord)),
        scale: scene.base.scale,
        width: num(preview.engine.width, 10),
        style: engineStyle(scene.base.palette, 0.55, true, true),
      });
    }
  }

  if (preview.kind === 'engineSize' && scene.selectedEngine) {
    drawEngineVisual(ctx, {
      angle: num(scene.selectedEngine.angle, 0),
      length: preview.length,
      point: relativeToCanvas(scene, scene.engineLoc),
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
  if (scene.sprite) {
    const bottomLeft = shipToCanvas(scene, [0, 0]);
    const drawWidth = scene.sprite.height * scene.base.scale;
    ctx.save();
    ctx.translate(bottomLeft.x + drawWidth, bottomLeft.y);
    ctx.rotate(Math.PI / 2);
    const sprite = (scene.mode === 'weapon' || scene.mode === 'launchBay' ? scene.tintedSprite : null) ?? scene.sprite;
    drawPixelImage(ctx, sprite, 0, 0, scene.sprite.width * scene.base.scale, scene.sprite.height * scene.base.scale);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  if (scene.mode === 'ranges' || scene.mode === 'overview') {
    const sp = relativeToCanvas(scene, scene.shieldCenter);
    const cp = shipCenterPoint(scene);
    drawRadiusFill(ctx, cp, num(scene.ship.collisionRadius, 0) * scene.base.scale, 'rgba(240, 230, 140, 0.15)');
    drawRadiusFill(ctx, sp, num(scene.ship.shieldRadius, 0) * scene.base.scale, 'rgba(175, 215, 230, 0.15)');
    drawCrossMarker(ctx, cp, centerMarkerStyle(scene.base.palette, scene.dragKind === 'center', scene.hovered?.kind === 'center'));
    drawXMarker(ctx, sp, centerMarkerStyle(scene.base.palette, scene.dragKind === 'shield', scene.hovered?.kind === 'shield'));
  }
  if (scene.bounds.length >= 4 && (scene.mode === 'bounds' || scene.mode === 'overview')) {
    const points = [];
    for (let i = 0; i < scene.bounds.length; i += 2) points.push(relativeToCanvas(scene, [scene.bounds[i] ?? 0, scene.bounds[i + 1] ?? 0]));
    renderCanvasBounds(
      ctx,
      scene.base.palette,
      points,
      scene.mode === 'bounds' ? scene.selected : null,
      scene.mode === 'bounds' && scene.hovered?.kind === 'bound' ? scene.hovered.i : null,
    );
  }
  if (scene.mode === 'weapon' || scene.mode === 'launchBay' || scene.mode === 'overview')
    scene.slots.forEach((slot, i) => {
      const isLaunchBay = str(slot.type).toUpperCase() === 'LAUNCH_BAY';
      if (scene.mode === 'weapon' && isLaunchBay) return;
      if (scene.mode === 'launchBay' && !isLaunchBay) return;
      if (scene.preview?.kind === 'weaponMove' && scene.mode === 'weapon' && i === scene.selected) return;
      if (isLaunchBay) {
        const baySelected = scene.selected === i;
        bayPorts(slot.locations).forEach((port, portIndex) => {
          const hovered = scene.hovered?.kind === 'launchBayPort' && scene.hovered.i === i && scene.hovered.port === portIndex;
          const accent = baySelected && scene.selectedPort === portIndex;
          drawLaunchBayPortVisual(ctx, {
            point: relativeToCanvas(scene, port),
            style: launchBayPortStyle(hovered || baySelected ? 1 : 0.65, hovered, accent),
          });
        });
        return;
      }
      drawWeaponSlotVisual(ctx, {
        angle: num(slot.angle, 0),
        arc: num(slot.arc, 0),
        mount: str(slot.mount),
        point: relativeToCanvas(scene, arr(slot.locations, [0, 0])),
        size: str(slot.size, 'MEDIUM'),
        type: str(slot.type, 'SYSTEM'),
        style: weaponSlotStyle(
          str(slot.type, 'SYSTEM'),
          (scene.mode === 'weapon' || scene.mode === 'launchBay') && i === scene.selected ? 1 : 0.6,
        ),
      });
    });
  if (scene.mode === 'engine' || scene.mode === 'overview')
    scene.engines.forEach((eng, i) => {
      if (scene.preview?.kind === 'engineMove' && scene.mode === 'engine' && i === scene.selected) return;
      drawEngineVisual(ctx, {
        angle: num(eng.angle, 0),
        length: num(eng.length, 20),
        point: relativeToCanvas(scene, arr(eng.location, [0, 0])),
        scale: scene.base.scale,
        width: num(eng.width, 10),
        style: engineStyle(
          scene.base.palette,
          1,
          scene.mode === 'engine' && i === scene.selected,
          scene.mode === 'engine' && scene.hovered?.kind === 'engine' && scene.hovered.i === i,
        ),
      });
    });
  if (scene.preview) renderPreview(ctx, scene, scene.preview);
  renderCanvasCursor(ctx, scene.base);
}
