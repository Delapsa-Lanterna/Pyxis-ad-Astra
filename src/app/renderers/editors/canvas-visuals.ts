import type { Point } from '@/domain/editors/editor-types';
import { SLOT_RADIUS } from '@/shared/lib/starsector';
import type { OutlineStyle, PointStyle, MarkerStyle, engineStyle, launchBayPortStyle, barrelStyle, weaponSlotStyle } from './canvas-styles';

export function strokeCanvasOutline(ctx: CanvasRenderingContext2D, style: OutlineStyle) {
  ctx.strokeStyle = style.outline;
  ctx.lineWidth = style.outlineWidth;
  ctx.stroke();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.stroke();
}

interface WeaponSlotVisualOptions {
  style: ReturnType<typeof weaponSlotStyle>;
  angle: number;
  arc: number;
  mount: string;
  point: Point;
  size: string;
  type: string;
}

interface EngineVisualOptions {
  style: ReturnType<typeof engineStyle>;
  angle: number;
  length: number;
  point: Point;
  scale: number;
  width: number;
}

interface BarrelVisualOptions {
  style: ReturnType<typeof barrelStyle>;
  angle: number;
  index: number;
  point: Point;
}

function radiusFor(size: string): number {
  const radius = SLOT_RADIUS[size as keyof typeof SLOT_RADIUS];
  return radius ?? SLOT_RADIUS.MEDIUM;
}

function usesSizeLayers(type: string) {
  return type === 'BALLISTIC' || type === 'ENERGY' || type === 'MISSILE';
}

function layerRadiiFor(type: string, size: string, scale: number) {
  if (!usesSizeLayers(type)) return [radiusFor(size) * scale];
  if (size === 'LARGE') return [SLOT_RADIUS.LARGE, SLOT_RADIUS.MEDIUM, SLOT_RADIUS.SMALL].map((radius) => radius * scale);
  if (size === 'MEDIUM') return [SLOT_RADIUS.MEDIUM, SLOT_RADIUS.SMALL].map((radius) => radius * scale);
  return [SLOT_RADIUS.SMALL * scale];
}

function withStroke(ctx: CanvasRenderingContext2D, color: string, width: number, draw: () => void) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  draw();
  ctx.stroke();
}

function drawCircle(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
}

function drawSquare(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  ctx.rect(-radius, -radius, radius * 2, radius * 2);
}

function drawDiamond(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius, 0);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius, 0);
  ctx.closePath();
}

function drawPentagon(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawHexagon(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = Math.PI / 6 + (i * Math.PI * 2) / 6;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawTriangle(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath();
  ctx.moveTo(-radius * 0.78, -radius);
  ctx.lineTo(radius * 1.1, 0);
  ctx.lineTo(-radius * 0.78, radius);
  ctx.closePath();
}

function drawHash(ctx: CanvasRenderingContext2D, radius: number) {
  const inner = radius * 0.35;
  ctx.beginPath();
  ctx.moveTo(-inner, -radius);
  ctx.lineTo(-inner, radius);
  ctx.moveTo(inner, -radius);
  ctx.lineTo(inner, radius);
  ctx.moveTo(-radius, -inner);
  ctx.lineTo(radius, -inner);
  ctx.moveTo(-radius, inner);
  ctx.lineTo(radius, inner);
}

function drawOutline(ctx: CanvasRenderingContext2D, type: string, radius: number, color: string, width: number) {
  if (type === 'BALLISTIC') withStroke(ctx, color, width, () => drawSquare(ctx, radius));
  else if (type === 'ENERGY') withStroke(ctx, color, width, () => drawCircle(ctx, radius));
  else if (type === 'MISSILE') withStroke(ctx, color, width, () => drawDiamond(ctx, radius));
  else if (type === 'HYBRID') {
    withStroke(ctx, color, width, () => drawCircle(ctx, radius));
    withStroke(ctx, color, width, () => drawSquare(ctx, radius / Math.SQRT2));
  } else if (type === 'UNIVERSAL') {
    withStroke(ctx, color, width, () => drawSquare(ctx, radius));
    withStroke(ctx, color, width, () => drawCircle(ctx, radius * 0.88));
    withStroke(ctx, color, width, () => drawDiamond(ctx, radius * 0.9));
  } else if (type === 'SYNERGY') {
    withStroke(ctx, color, width, () => drawCircle(ctx, radius));
    withStroke(ctx, color, width, () => drawDiamond(ctx, radius * 0.88));
  } else if (type === 'COMPOSITE') {
    withStroke(ctx, color, width, () => drawSquare(ctx, radius));
    withStroke(ctx, color, width, () => drawDiamond(ctx, radius * 0.9));
  } else if (type === 'LAUNCH_BAY') {
    withStroke(ctx, color, width, () => drawHash(ctx, radius * 0.8));
  } else if (type === 'DECORATIVE') {
    withStroke(ctx, color, width, () => drawTriangle(ctx, radius * 1.1));
  } else if (type === 'STATION_MODULE') {
    withStroke(ctx, color, width, () => drawHexagon(ctx, radius * 0.92));
  } else if (type !== 'SYSTEM') {
    withStroke(ctx, color, width, () => drawPentagon(ctx, radius * 0.92));
  }
}

function drawSlotCenter(ctx: CanvasRenderingContext2D, color: string, radius: number) {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawArcAndFacing(ctx: CanvasRenderingContext2D, radius: number, arc: number, style: ReturnType<typeof weaponSlotStyle>) {
  const clampedArc = Math.max(0, Math.min(360, arc || 0));
  if (clampedArc > 0) {
    const half = (clampedArc * Math.PI) / 360;
    const start = -half;
    const end = half;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.arcWidth;
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, end);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(start) * radius * 1.18, Math.sin(start) * radius * 1.18);
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(end) * radius * 1.18, Math.sin(end) * radius * 1.18);
    ctx.stroke();
  }
  ctx.strokeStyle = style.facingColor;
  ctx.lineWidth = style.facingWidth;
  ctx.beginPath();
  ctx.moveTo(radius * 1.2, 0);
  ctx.lineTo(8, 0);
  ctx.stroke();
}

export function drawWeaponSlotVisual(ctx: CanvasRenderingContext2D, options: WeaponSlotVisualOptions) {
  const type = (options.type || 'SYSTEM').toUpperCase();
  const { color } = options.style;
  const size = (options.size || 'MEDIUM').toUpperCase();
  const radiusScale = 1.5;
  const base = radiusFor(size) * radiusScale;
  const outlineRadii = layerRadiiFor(type, size, radiusScale);

  ctx.save();
  ctx.translate(options.point.x, options.point.y);
  ctx.globalAlpha = options.style.alpha;
  if (type !== 'LAUNCH_BAY') {
    ctx.save();
    ctx.rotate((-options.angle * Math.PI) / 180);
    drawArcAndFacing(ctx, base * 1.85, options.arc, options.style);
    ctx.restore();
  }

  if (type !== 'SYSTEM') {
    outlineRadii.forEach((radius) => drawOutline(ctx, type, radius, color, options.style.outlineWidth));
  }
  if (options.mount === 'HARDPOINT') {
    ctx.strokeStyle = color;
    ctx.lineWidth = options.style.outlineWidth;
    ctx.beginPath();
    ctx.moveTo(-base * 0.9, base * 0.9);
    ctx.lineTo(base * 0.9, -base * 0.9);
    ctx.stroke();
  }
  drawSlotCenter(ctx, color, options.style.centerRadius);
  ctx.restore();
}

interface LaunchBayPortVisualOptions {
  point: Point;
  style: ReturnType<typeof launchBayPortStyle>;
}

/// Renders one launch bay port as a small thin ring — the bay itself is never
/// drawn on the canvas, every port stands in for it.
export function drawLaunchBayPortVisual(ctx: CanvasRenderingContext2D, options: LaunchBayPortVisualOptions) {
  const { point, style } = options;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.globalAlpha = style.alpha;
  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.arc(0, 0, style.centerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.beginPath();
  ctx.arc(0, 0, style.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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

export function drawEngineVisual(ctx: CanvasRenderingContext2D, options: EngineVisualOptions) {
  const width = Math.max(4, options.width * options.scale);
  const length = Math.max(8, options.length * options.scale);

  ctx.save();
  ctx.globalAlpha = options.style.alpha;
  ctx.save();
  ctx.translate(options.point.x, options.point.y);
  ctx.rotate((-options.angle * Math.PI) / 180);
  ctx.fillStyle = options.style.body;
  ctx.fillRect(0, -width / 2, length, width);

  const flame = ctx.createLinearGradient(0, 0, length, 0);
  for (const [offset, color] of options.style.flame) flame.addColorStop(offset, color);
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(0, -width * 0.45);
  ctx.quadraticCurveTo(length * 0.55, -width * 0.35, length, 0);
  ctx.quadraticCurveTo(length * 0.55, width * 0.35, 0, width * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawControlPoint(ctx, options.point, options.style.control);
  ctx.restore();
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
