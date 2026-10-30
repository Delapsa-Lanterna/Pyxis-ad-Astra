import type { Point } from '@/domain/editors/editor-types';
import { SLOT_RADIUS, WEAPON_COLORS } from '@/shared/lib/starsector';

export function weaponSlotColor(type: string): string {
  return WEAPON_COLORS[type.toUpperCase() as keyof typeof WEAPON_COLORS] ?? '#9ca3af';
}

export function launchBayPortStyle(alpha: number, hovered = false, accent = false) {
  return {
    alpha,
    color: weaponSlotColor('LAUNCH_BAY'),
    radius: 10,
    centerRadius: accent ? 4.5 : 2.2,
    width: hovered || accent ? 1.8 : 1.1,
  };
}

export function weaponSlotStyle(type: string, alpha: number) {
  return { alpha, color: weaponSlotColor(type), outlineWidth: 2.2, arcWidth: 2, facingColor: '#d8d8d8', facingWidth: 2, centerRadius: 5 };
}

interface WeaponSlotVisualOptions {
  showArc?: boolean;
  style: ReturnType<typeof weaponSlotStyle>;
  refit?: { scale: number; highlighted: boolean; builtin: boolean };
  angle: number;
  arc: number;
  mount: string;
  point: Point;
  size: string;
  type: string;
}

function radiusFor(size: string): number {
  const radius = SLOT_RADIUS[size as keyof typeof SLOT_RADIUS];
  return radius ?? SLOT_RADIUS.MEDIUM;
}

function usesSizeLayers(type: string) {
  return type === 'BALLISTIC' || type === 'ENERGY' || type === 'MISSILE';
}

function layerRadiiFor(type: string, size: string) {
  if (!usesSizeLayers(type)) return [radiusFor(size)];
  const layers = size === 'LARGE' ? ['LARGE', 'MEDIUM', 'SMALL'] : size === 'MEDIUM' ? ['MEDIUM', 'SMALL'] : ['SMALL'];
  return layers.map(radiusFor);
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

function drawOutline(ctx: CanvasRenderingContext2D, type: string, radius: number, color: string, width: number, zoom?: number) {
  const stroke = (shape: (ctx: CanvasRenderingContext2D, radius: number) => void, radius: number) => {
    if (zoom === undefined) {
      withStroke(ctx, color, width, () => shape(ctx, radius));
      return;
    }
    // Compensate line thickness while the mount geometry follows the viewport.
    for (let pass = 0; pass < 3; pass++) {
      const thickness = 2.5 / zoom - pass * 0.5;
      const inset = ((shape === drawDiamond ? Math.SQRT2 : 1) * thickness) / 2;
      withStroke(ctx, color, thickness, () => shape(ctx, radius - pass * 0.25 - inset));
    }
  };
  if (type === 'BALLISTIC') stroke(drawSquare, radius);
  else if (type === 'ENERGY') stroke(drawCircle, radius);
  else if (type === 'MISSILE') stroke(drawDiamond, radius);
  else if (type === 'HYBRID') {
    stroke(drawCircle, radius);
    stroke(drawSquare, radius / Math.SQRT2);
  } else if (type === 'UNIVERSAL') {
    stroke(drawSquare, radius * 0.71);
    stroke(drawCircle, radius);
    stroke(drawDiamond, radius * 0.71);
  } else if (type === 'SYNERGY') {
    stroke(drawCircle, radius);
    stroke(drawDiamond, radius * 0.71);
  } else if (type === 'COMPOSITE') {
    stroke(drawSquare, radius);
    stroke(drawDiamond, radius * 0.9);
  } else if (type === 'LAUNCH_BAY') {
    stroke(drawHash, radius * 0.8);
  } else if (type === 'DECORATIVE') {
    stroke(drawTriangle, radius * 1.1);
  } else if (type === 'STATION_MODULE') {
    stroke(drawHexagon, radius * 0.92);
  } else if (type !== 'SYSTEM') {
    stroke(drawPentagon, radius * 0.92);
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
  const base = radiusFor(size) * 1.2;
  const outlineRadii = layerRadiiFor(type, size);

  ctx.save();
  ctx.translate(options.point.x, options.point.y);
  ctx.globalAlpha = options.style.alpha;
  if (type !== 'LAUNCH_BAY' && options.showArc !== false) {
    ctx.save();
    ctx.rotate((-options.angle * Math.PI) / 180);
    drawArcAndFacing(ctx, base * 1.85, options.arc, options.style);
    ctx.restore();
  }

  if (type !== 'SYSTEM') {
    ctx.save();
    const refit = options.refit;
    const zoom = refit ? refit.scale * (refit.builtin ? 0.66 : refit.highlighted ? 1 : 0.66) : undefined;
    if (zoom !== undefined) ctx.scale(zoom, zoom);
    outlineRadii.forEach((radius, index) => {
      if (refit)
        ctx.globalAlpha = (refit.highlighted ? 1 : 0.25) * (refit.builtin ? 0.3 : 0.5) * (usesSizeLayers(type) ? 0.5 ** index : 0.7);
      drawOutline(ctx, type, radius, color, options.style.outlineWidth, zoom);
    });
    ctx.restore();
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
