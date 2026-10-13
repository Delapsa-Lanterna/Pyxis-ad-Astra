import type { Point } from '@/domain/editors/editor-types';

export function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, color: string): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

export function drawCanvasGrid(
  ctx: CanvasRenderingContext2D,
  options: { center: Point; height: number; scale: number; width: number; color: string },
): void {
  const step = 50 * options.scale;
  if (step < 5) return;
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 0.5;
  for (let x = options.center.x % step; x < options.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, options.height);
    ctx.stroke();
  }
  for (let y = options.center.y % step; y < options.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(options.width, y);
    ctx.stroke();
  }
}

export function drawPixelImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x, y, width, height);
  ctx.imageSmoothingEnabled = smoothing;
}
