import type { Point } from '@/domain/editors/editor-types';
import type { OutlineStyle, PointStyle, MarkerStyle, barrelStyle } from './canvas-styles';

export function strokeCanvasOutline(ctx: CanvasRenderingContext2D, style: OutlineStyle) {
  ctx.strokeStyle = style.outline;
  ctx.lineWidth = style.outlineWidth;
  ctx.stroke();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.stroke();
}

interface BarrelVisualOptions {
  style: ReturnType<typeof barrelStyle>;
  angle: number;
  index: number;
  point: Point;
}

export function drawBoundsVisual(ctx: CanvasRenderingContext2D, points: Point[], line: OutlineStyle, controls: PointStyle[]) {
  if (points.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  strokeCanvasOutline(ctx, line);
  points.forEach((point, index) => drawControlPoint(ctx, point, controls[index]!));
}

export function drawControlPoint(ctx: CanvasRenderingContext2D, point: Point, style: PointStyle) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, style.radius, 0, Math.PI * 2);
  ctx.fillStyle = style.color;
  ctx.fill();
  ctx.strokeStyle = style.outline;
  ctx.lineWidth = style.width;
  ctx.stroke();
}

export function drawRadiusFill(ctx: CanvasRenderingContext2D, center: Point, radius: number, fill: string) {
  if (radius > 0) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

export function drawRadiusField(
  ctx: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  fill: string,
  style: MarkerStyle,
  marker: 'cross' | 'x' = 'cross',
) {
  drawRadiusFill(ctx, center, radius, fill);
  if (marker === 'x') drawXMarker(ctx, center, style);
  else drawCrossMarker(ctx, center, style);
}

export function drawCrossMarker(ctx: CanvasRenderingContext2D, point: Point, style: MarkerStyle, label?: string) {
  ctx.beginPath();
  ctx.moveTo(point.x - style.radius, point.y);
  ctx.lineTo(point.x + style.radius, point.y);
  ctx.moveTo(point.x, point.y - style.radius);
  ctx.lineTo(point.x, point.y + style.radius);
  strokeCanvasOutline(ctx, style);
  if (label) {
    ctx.font = '18px sans-serif';
    ctx.fillStyle = style.color;
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeText(label, point.x + 10, point.y + 14);
    ctx.fillText(label, point.x + 10, point.y + 14);
  }
}

export function drawXMarker(ctx: CanvasRenderingContext2D, point: Point, style: MarkerStyle) {
  ctx.beginPath();
  ctx.moveTo(point.x - style.radius, point.y - style.radius);
  ctx.lineTo(point.x + style.radius, point.y + style.radius);
  ctx.moveTo(point.x + style.radius, point.y - style.radius);
  ctx.lineTo(point.x - style.radius, point.y + style.radius);
  strokeCanvasOutline(ctx, style);
}

export function drawWeaponSpriteLayer(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement,
  originRatio: { x: number; y: number },
  scale: number,
  centerX: number,
  centerY: number,
) {
  if (!image.width) return;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(Math.PI / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, -drawWidth * originRatio.x, -drawHeight * originRatio.y, drawWidth, drawHeight);
  ctx.restore();
}

export function drawWeaponGlow(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  tintedImage: HTMLCanvasElement,
  options: { tintAlpha: number; coreAlpha: number; origin: Point; center: Point; scale: number },
  random: () => number,
) {
  ctx.save();
  for (let i = 0; i < 15; i++) {
    const core = i >= 12;
    const step = core ? 0.05 : 0.1;
    ctx.globalAlpha = core ? options.coreAlpha : options.tintAlpha;
    ctx.globalCompositeOperation = core ? 'lighter' : 'source-over';
    const x = options.center.x + (Math.floor(random() * 21) - 10) * step * options.scale;
    const y = options.center.y + (Math.floor(random() * 21) - 10) * step * options.scale;
    drawWeaponSpriteLayer(ctx, core ? image : tintedImage, options.origin, options.scale, x, y);
  }
  ctx.restore();
}

export function drawBarrelVisual(ctx: CanvasRenderingContext2D, options: BarrelVisualOptions) {
  const length = 36;
  const angle = (options.angle * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = options.style.alpha;
  ctx.beginPath();
  ctx.moveTo(options.point.x, options.point.y);
  ctx.lineTo(options.point.x + Math.cos(angle) * length, options.point.y - Math.sin(angle) * length);
  strokeCanvasOutline(ctx, options.style.line);
  drawControlPoint(ctx, options.point, options.style.control);
  ctx.globalAlpha = options.style.label.alpha;
  ctx.font = '11px sans-serif';
  ctx.fillStyle = options.style.label.color;
  ctx.strokeStyle = options.style.label.outline;
  ctx.lineWidth = options.style.label.width;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(String(options.index + 1), options.point.x, options.point.y);
  ctx.fillText(String(options.index + 1), options.point.x, options.point.y);
  ctx.restore();
}
