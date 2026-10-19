import type { DeepReadonly, EngineEffect, RowData } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';

const white = [255, 255, 255];
const layers = [
  ['engineGlow', 0.5, 1],
  ['engineFlame', 0.45, 1],
  ['engineHitGlow', 0, 2],
] as const;
export interface EngineImages {
  styles: DeepReadonly<RowData>;
  image(effect: EngineEffect, color: readonly unknown[]): HTMLCanvasElement | HTMLImageElement | null;
}
export function engineColor(engine: { style?: unknown; styleSpec?: unknown }, styles: DeepReadonly<RowData>): readonly unknown[] {
  const style = engine.style === 'CUSTOM' && isRowData(engine.styleSpec) ? engine.styleSpec : styles[String(engine.style)];
  return isRowData(style) && Array.isArray(style.engineColor) ? style.engineColor : white;
}
export function drawEngineVisual(
  ctx: CanvasRenderingContext2D,
  options: {
    point: { x: number; y: number };
    rotation: number;
    scale: number;
    width: number;
    length: number;
    color: readonly unknown[];
    alpha: number;
  },
  assets: EngineImages,
) {
  ctx.save();
  ctx.translate(options.point.x, options.point.y);
  ctx.rotate(options.rotation);
  ctx.scale(options.scale, options.scale);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = options.alpha * 0.6;
  for (const [effect, lengthFactor, widthFactor] of layers) {
    const height = options.width * widthFactor,
      width = lengthFactor ? options.length * lengthFactor : height;
    const image = assets.image(effect, options.color);
    if (image) ctx.drawImage(image, effect === 'engineHitGlow' ? -width / 2 : 0, -height / 2, width, height);
  }
  ctx.restore();
}
