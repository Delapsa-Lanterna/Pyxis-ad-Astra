import type { DeepReadonly, EngineEffect, RowData } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';

export type EnginePreset = 'full-thrust' | 'refit';
export type EngineKind = 'ship' | 'fighter' | 'missile';
export interface EngineShape {
  width: number;
  length: number;
  preset: EnginePreset;
  kind: EngineKind;
  alpha: number;
  style?: unknown;
  styleId?: unknown;
  styleSpec?: unknown;
}
export interface EngineProduct {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  ratio: number;
}
export interface EngineImages {
  product(shape: EngineShape): EngineProduct | null;
}
const emptyStyle = {};
export function engineStyle(
  engine: Pick<EngineShape, 'style' | 'styleId' | 'styleSpec'>,
  styles: DeepReadonly<RowData>,
): DeepReadonly<RowData> {
  const value =
    engine.style === 'CUSTOM' ? (engine.styleId ? styles[String(engine.styleId)] : engine.styleSpec) : styles[String(engine.style)];
  return isRowData(value) ? value : emptyStyle;
}
export const ENGINE_PATHS = {
  engineGlow: 'graphics/fx/engineglow32.png',
  engineFlame: 'graphics/fx/engineflame32.png',
  engineHitGlow: 'graphics/fx/hit_glow.png',
};
export function enginePaths(style: DeepReadonly<RowData>) {
  return {
    ...ENGINE_PATHS,
    engineGlow: String(style.glowSprite || ENGINE_PATHS.engineGlow),
    engineFlame: String(style.glowOutline || ENGINE_PATHS.engineFlame),
  };
}
export function engineDimensions(shape: EngineShape) {
  const full = shape.preset === 'full-thrust',
    width = shape.width * (full ? 1 : 0.505),
    length = shape.length * (full ? 1 : 0.2);
  const glow = width * 2 * (shape.kind === 'missile' ? 2 : shape.kind === 'fighter' ? 0.66 : 1) * 0.915;
  return { width, length, glow, level: full ? 1 : 0.4, peak: Math.min(width / 2, length / 4) };
}
export function engineBounds(shape: EngineShape, style: DeepReadonly<RowData>, ratio: number) {
  const { glow, width } = engineDimensions(shape),
    size = glow * Number(style.glowSizeMult ?? 1);
  return { x: -size * (shape.kind === 'fighter' ? 1 : 0.9) - 1 / ratio, y: -Math.max(size, width / 2) - 1 / ratio };
}
function rgba(value: unknown): readonly number[] {
  return Array.isArray(value) ? [value[0], value[1], value[2], value[3] ?? 255] : [255, 255, 255, 255];
}
function tint(image: HTMLImageElement, color: readonly number[]) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4)
    for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = (pixels.data[i + channel]! * color[channel]!) / 255;
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
function textureSpan(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  left: number,
  right: number,
  u: number,
  span: number,
  height: number,
) {
  let offset = 0;
  while (offset < span) {
    const start = (u + offset) % 1,
      part = Math.min(1 - start, span - offset);
    ctx.drawImage(
      image,
      start * image.width,
      image.height * 0.01,
      part * image.width,
      image.height * 0.98,
      left + ((right - left) * offset) / span,
      0,
      ((right - left) * part) / span,
      height,
    );
    offset += part;
  }
}
export function createEngineProduct(
  shape: EngineShape,
  style: DeepReadonly<RowData>,
  images: Record<EngineEffect, HTMLImageElement>,
  ratio: number,
): EngineProduct {
  const { width, length, glow, level, peak } = engineDimensions(shape),
    color = rgba(style.engineColor),
    outer = rgba(style.glowAlternateColor ?? color);
  const size = glow * Number(style.glowSizeMult ?? 1),
    axis = shape.kind === 'fighter' ? 1 : 0.9,
    radius = size * axis;
  const canvas = document.createElement('canvas'),
    { x, y } = engineBounds(shape, style, ratio);
  canvas.width = Math.ceil((Math.max(length, radius) - x) * ratio);
  canvas.height = Math.ceil(-y * 2 * ratio);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, -x * ratio, -y * ratio);
  ctx.globalCompositeOperation = 'lighter';
  const glowImage = tint(images.engineGlow, color),
    outline = tint(images.engineFlame, color);
  const ribbon = document.createElement('canvas');
  ribbon.width = Math.max(1, Math.ceil(length * ratio));
  ribbon.height = Math.max(1, Math.ceil(width * ratio));
  const strip = ribbon.getContext('2d')!,
    count = shape.kind === 'fighter' ? 3 : style.omegaMode ? 1 : 6;
  const passes = shape.kind !== 'fighter' && style.omegaMode ? 2 : 1;
  for (let pass = 0; pass < passes; pass++)
    for (let i = 0; i < count; i++) {
      strip.setTransform(ratio, 0, 0, ratio, 0, 0);
      strip.clearRect(0, 0, length, width);
      strip.globalCompositeOperation = 'source-over';
      textureSpan(strip, glowImage, 0, peak, i / count, peak / length, width);
      textureSpan(strip, glowImage, peak, length, i / count + peak / length, level - peak / length, width);
      const fade = strip.createLinearGradient(0, 0, length, 0);
      fade.addColorStop(0, 'rgba(255,255,255,' + (i * 5) / 255 + ')');
      fade.addColorStop(peak / length, 'rgba(255,255,255,' + (shape.kind === 'fighter' ? 1 : 100 / 255) + ')');
      fade.addColorStop(1, 'rgba(255,255,255,0)');
      strip.globalCompositeOperation = 'destination-in';
      strip.fillStyle = fade;
      strip.fillRect(0, 0, length, width);
      ctx.globalAlpha = (shape.alpha * color[3]!) / 255;
      ctx.drawImage(
        ribbon,
        ((count - i - 1) * peak) / (count * 2),
        (-width * (count - i)) / count / 2,
        length * (0.5 + (0.5 * (i + 1)) / count),
        (width * (count - i)) / count,
      );
    }
  if (shape.kind !== 'fighter') {
    ctx.globalAlpha = (((shape.alpha * color[3]!) / 255) * level * 50) / 255;
    ctx.drawImage(
      outline,
      outline.width * 0.01,
      outline.height * 0.01,
      outline.width * 0.98,
      outline.height * 0.98,
      0,
      -width / 2,
      length * 0.9,
      width,
    );
  }
  ctx.globalAlpha = ((shape.alpha * outer[3]!) / 255) * 0.45;
  ctx.drawImage(tint(images.engineHitGlow, outer), -size * axis, -size, size * axis * 2, size * 2);
  ctx.globalAlpha = shape.alpha * 0.45;
  ctx.drawImage(images.engineHitGlow, (-size * 0.75 * axis) / 2, (-size * 0.75) / 2, size * 0.75 * axis, size * 0.75);
  return { canvas, x, y, ratio };
}
export function drawEngineVisual(
  ctx: CanvasRenderingContext2D,
  options: EngineShape & { point: { x: number; y: number }; rotation: number; scale: number },
  assets: EngineImages,
) {
  const product = assets.product(options);
  if (!product) return;
  ctx.save();
  ctx.translate(options.point.x, options.point.y);
  ctx.rotate(options.rotation);
  ctx.scale(options.scale, options.scale);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  ctx.drawImage(product.canvas, product.x, product.y, product.canvas.width / product.ratio, product.canvas.height / product.ratio);
  ctx.restore();
}
