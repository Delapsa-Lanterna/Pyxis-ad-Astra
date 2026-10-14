import type { ProjectileGeometry } from '@/domain/editors/projectile-geometry';
import { rgba } from '@/shared/lib/starsector';
import { renderCanvasBase, type CanvasScene } from './canvas-scene';
import { centerMarkerStyle, engineStyle, outlineStyle } from './canvas-styles';
import { drawCrossMarker, drawEngineVisual, drawRadiusFill, strokeCanvasOutline } from './canvas-visuals';
import { drawPixelImage } from './canvas-drawing';

export interface ProjectileScene {
  base: CanvasScene;
  geometry: ProjectileGeometry;
  sprite: HTMLImageElement | null;
}
export function renderProjectileScene(ctx: CanvasRenderingContext2D, scene: ProjectileScene): void {
  const { base, geometry: g, sprite } = scene;
  renderCanvasBase(ctx, base);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(base.center.x, base.center.y);
  ctx.scale(base.scale, base.scale);
  if (sprite) {
    if (g.kind === 'missile') {
      ctx.rotate(Math.PI / 2);
      drawPixelImage(ctx, sprite, -g.center[0]!, -(g.size[1]! - g.center[1]!), g.size[0]!, g.size[1]!);
    } else drawPixelImage(ctx, sprite, g.body.x, g.body.y, g.body.width, g.body.height);
  } else if (g.kind === 'projectile' && !g.spritePath) {
    ctx.fillStyle = rgba(g.fringeColor);
    ctx.fillRect(g.body.x, g.body.y, g.body.width, g.body.height);
    ctx.fillStyle = rgba(g.coreColor);
    ctx.fillRect(g.body.x, g.body.y / 2, g.body.width, g.body.height / 2);
  }
  ctx.restore();
  if (g.kind === 'missile') drawRadiusFill(ctx, base.center, g.radius * base.scale, 'rgba(240, 230, 140, 0.15)');
  else if (g.kind === 'projectile') {
    ctx.beginPath();
    ctx.rect(
      base.center.x + g.body.x * base.scale,
      base.center.y + g.body.y * base.scale,
      g.body.width * base.scale,
      g.body.height * base.scale,
    );
    strokeCanvasOutline(ctx, outlineStyle(base.palette, 1));
  }
  drawCrossMarker(ctx, base.center, centerMarkerStyle(base.palette, false));
  for (const engine of g.engines)
    drawEngineVisual(ctx, {
      ...engine,
      point: { x: base.center.x + engine.point.x * base.scale, y: base.center.y + engine.point.y * base.scale },
      scale: base.scale,
      style: engineStyle(base.palette, 1, false),
    });
}
