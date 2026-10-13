import { outlineStyle, controlPointStyle } from './canvas-styles';
import type { Point } from '@/domain/editors/editor-types';
import type { CanvasPalette } from '@/domain/editors/lib/canvas-palette';
import { clearCanvas, drawCanvasGrid } from './canvas-drawing';
import { drawBoundsVisual, strokeCanvasOutline } from './canvas-visuals';

export interface CanvasScene {
  width: number;
  height: number;
  center: Point;
  scale: number;
  palette: CanvasPalette;
  mirrorY: number | null;
  cursor: { point: Point; label: string } | null;
}

export function renderCanvasBase(ctx: CanvasRenderingContext2D, scene: CanvasScene): void {
  clearCanvas(ctx, scene.width, scene.height, scene.palette.background);
  drawCanvasGrid(ctx, { ...scene, color: scene.palette.grid });
  if (scene.mirrorY === null) return;
  ctx.save();
  ctx.strokeStyle = scene.palette.highlight;
  ctx.fillStyle = scene.palette.highlight;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, scene.mirrorY);
  ctx.lineTo(scene.width, scene.mirrorY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText('镜像中轴', 8, scene.mirrorY - 4);
  ctx.restore();
}

export function renderCanvasCursor(ctx: CanvasRenderingContext2D, scene: CanvasScene): void {
  const marker = scene.cursor;
  if (!marker) return;
  ctx.save();
  ctx.fillStyle = scene.palette.marker;
  ctx.beginPath();
  ctx.moveTo(marker.point.x - 16, marker.point.y);
  ctx.lineTo(marker.point.x + 16, marker.point.y);
  ctx.moveTo(marker.point.x, marker.point.y - 16);
  ctx.lineTo(marker.point.x, marker.point.y + 16);
  strokeCanvasOutline(ctx, outlineStyle(scene.palette, 1.5));
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = scene.palette.outline;
  ctx.lineWidth = 1;
  ctx.strokeText(marker.label, marker.point.x + 12, marker.point.y + 12);
  ctx.fillText(marker.label, marker.point.x + 12, marker.point.y + 12);
  ctx.restore();
}

export function renderCanvasBounds(
  ctx: CanvasRenderingContext2D,
  palette: CanvasPalette,
  points: Point[],
  selected: number | null,
  hovered: number | null,
): void {
  drawBoundsVisual(
    ctx,
    points,
    { ...outlineStyle(palette, 2), outlineWidth: 4 },
    points.map((_, index) => controlPointStyle(palette, index === selected, index === hovered, 6)),
  );
}
