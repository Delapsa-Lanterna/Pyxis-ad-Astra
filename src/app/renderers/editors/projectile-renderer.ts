import type { Point } from '@/domain/editors/editor-types';
import type { ProjectileAppearance } from '@/domain/editors/projectile-appearance';
import { drawEngineVisual, type EngineImages } from './engine-renderer';

export type ProjectileTexture = HTMLImageElement | HTMLCanvasElement;
export type TextureShape = 'plain' | 'start' | 'end' | 'plasma6' | 'plasma5';
export interface ProjectileImages {
  image(key: string, color?: readonly number[], shape?: TextureShape, outer?: readonly number[]): ProjectileTexture | null;
  pattern(ctx: CanvasRenderingContext2D, key: string, color: readonly number[]): CanvasPattern;
}
export interface ProjectileVisual {
  appearance: ProjectileAppearance;
  point: Point;
  angle: number;
  length: number;
  alpha: number;
  phase: number;
  fringePhase: number;
  age: number;
  engineLevel: number;
}
function span(
  ctx: CanvasRenderingContext2D,
  image: ProjectileTexture,
  pattern: CanvasPattern,
  x: number,
  length: number,
  width: number,
  phase: number,
  period: number,
) {
  const offset = (((phase % 1) + 1) % 1) * period;
  ctx.save();
  ctx.translate(x - offset, -width / 2);
  ctx.scale(period / image.width, width / image.height);
  ctx.fillStyle = pattern;
  ctx.fillRect((offset * image.width) / period, 0, (length * image.width) / period, image.height);
  ctx.restore();
}
function ribbon(ctx: CanvasRenderingContext2D, images: ProjectileImages, visual: ProjectileVisual, layer: 'fringe' | 'core', cap: number) {
  const p = visual.appearance,
    color = p[layer],
    length = visual.length;
  const width = p.width * (layer === 'core' ? p.coreWidth : 1) * (p.kind === 'beam' ? visual.alpha : 1);
  const key =
    p.spawn === 'BALLISTIC' && p.kind === 'ballistic' ? (layer === 'fringe' ? 'projectileTrail' : 'projectileBody') : layer + 'Texture';
  const phase = layer === 'fringe' ? visual.fringePhase : visual.phase,
    period = p.spawn === 'BALLISTIC' && p.kind === 'ballistic' ? 128 : 128 * p.texel;
  const image = images.image(key, color),
    start = images.image(key, color, 'start'),
    end = images.image(key, color, 'end');
  if (!image || !start || !end || width <= 0) return;
  const inset = Math.min(p.kind === 'beam' ? p.width * visual.alpha * (p.dark ? 0.75 : 1 / 3) : cap, length / 2);
  ctx.globalAlpha *= (color[3] ?? 255) / 255;
  span(ctx, image, images.pattern(ctx, key, color), inset, Math.max(0, length - inset * 1.5), width, phase, period);
  ctx.drawImage(start, -inset, -width / 2, inset * 2, width);
  ctx.drawImage(end, length - inset / 2, -width / 2, cap, width);
}
export function drawBeamVisual(ctx: CanvasRenderingContext2D, visual: ProjectileVisual, images: ProjectileImages) {
  const p = visual.appearance,
    width = p.width * visual.alpha,
    cap = width * (p.dark ? 0.75 : 1 / 3);
  if (visual.length <= 0 || width <= 0) return;
  ctx.save();
  ctx.translate(visual.point.x, visual.point.y);
  ctx.rotate(-visual.angle);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < (p.dark ? p.fringePasses : 1); i++) {
    ctx.globalAlpha = visual.alpha ** 2;
    ribbon(ctx, images, visual, 'fringe', width);
  }
  ctx.globalCompositeOperation = p.dark ? 'source-over' : 'lighter';
  for (let i = 0; i < (p.dark ? p.corePasses : 1); i++) {
    ctx.globalAlpha = visual.alpha ** 2;
    ribbon(ctx, images, visual, 'core', cap);
  }
  ctx.restore();
}
export function drawProjectileVisual(
  ctx: CanvasRenderingContext2D,
  visual: ProjectileVisual,
  images: ProjectileImages,
  engines: EngineImages,
) {
  const p = visual.appearance;
  if (p.kind === 'beam') {
    drawBeamVisual(ctx, visual, images);
    return;
  }
  if (!visual.alpha || p.kind === 'none') return;
  ctx.save();
  ctx.translate(visual.point.x, visual.point.y);
  ctx.rotate(-visual.angle);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = visual.alpha;
  if (p.glowRadius > 0) {
    const glow = images.image('hitGlow', p.glowColor);
    if (glow) {
      ctx.globalAlpha *= (p.glowColor[3] ?? 255) / 255;
      ctx.drawImage(glow, -p.glowRadius, -p.glowRadius, p.glowRadius * 2, p.glowRadius * 2);
      ctx.globalAlpha = visual.alpha;
    }
  }
  if (p.kind === 'missile') {
    const body = images.image('sprite');
    ctx.globalCompositeOperation = p.glowRadius > 0 ? 'lighter' : 'source-over';
    ctx.save();
    ctx.rotate(Math.PI / 2);
    if (body) ctx.drawImage(body, -p.center[0]!, -(p.size[1]! - p.center[1]!), p.size[0]!, p.size[1]!);
    ctx.restore();
    const glow = images.image('glowSprite', p.glowColor);
    if (glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= (p.glowColor[3] ?? 255) / 255;
      ctx.save();
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(glow, -p.center[0]!, -(p.size[1]! - p.center[1]!), p.size[0]!, p.size[1]!);
      ctx.restore();
    }
    for (const engine of visual.engineLevel > 0 ? p.engines : [])
      drawEngineVisual(
        ctx,
        {
          ...engine,
          rotation: (-engine.angle * Math.PI) / 180,
          scale: 1,
          alpha: 1,
          opacity: visual.alpha * visual.engineLevel,
          preset: 'full-thrust',
          kind: 'missile',
        },
        engines,
      );
  } else if (p.kind === 'plasma') {
    for (const count of [6, 5] as const) {
      const image = images.image('plasmaRay', p.core, count === 6 ? 'plasma6' : 'plasma5', p.fringe);
      if (image) {
        ctx.save();
        ctx.rotate((visual.age * (count === 6 ? 160 : -160) * Math.PI) / 180);
        ctx.drawImage(image, -p.width, -p.width, p.width * 2, p.width * 2);
        ctx.restore();
      }
    }
  } else {
    const bullet = images.image('bulletSprite', p.core);
    const brightness = visual.alpha * Math.min(1, visual.length / Math.max(p.length, 1));
    ctx.translate(-visual.length, 0);
    ctx.globalAlpha = brightness ** 2;
    ribbon(ctx, images, visual, 'fringe', p.width / 2);
    if (bullet) {
      ctx.translate(visual.length, 0);
      ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = (brightness ** 2 * (p.core[3] ?? 255)) / 255;
      ctx.drawImage(
        bullet,
        (-p.width * p.coreWidth) / 2,
        (-bullet.height / bullet.width) * p.width,
        p.width * p.coreWidth,
        (bullet.height / bullet.width) * p.width,
      );
    } else
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = brightness ** 2;
        ribbon(ctx, images, visual, 'core', p.width / 2);
      }
  }
  ctx.restore();
}
