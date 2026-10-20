import type { ProjectileGeometry } from '@/domain/spec-editor/projectile/spec-projectile-model';
import { rgba } from '@/shared/lib/starsector/index';
import { renderCanvasBase, type CanvasScene } from '../../editors/canvas-scene';
import { centerMarkerStyle, controlPointStyle, outlineStyle } from '../../editors/canvas-styles';
import { drawCrossMarker, drawControlPoint, drawRadiusFill, strokeCanvasOutline } from '../../editors/canvas-visuals';
import { drawEngineVisual, type EngineImages } from '../../editors/engine-renderer';
import { drawPixelImage } from '../../editors/canvas-drawing';

export interface SpecProjectileEditorScene {
  engineImages: EngineImages;
  base: CanvasScene;
  geometry: ProjectileGeometry;
  sprite: HTMLImageElement | null;
}
export function renderSpecProjectileEditorScene(ctx: CanvasRenderingContext2D, scene: SpecProjectileEditorScene): void {
  const { base, geometry: g, sprite } = scene;
  renderCanvasBase(ctx, base);
  const engines = g.engines.map((engine) => ({
    ...engine,
    point: { x: base.center.x + engine.point.x * base.scale, y: base.center.y + engine.point.y * base.scale },
  }));
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
  for (const engine of engines)
    drawEngineVisual(
      ctx,
      { ...engine, rotation: (-engine.angle * Math.PI) / 180, scale: base.scale, alpha: 1, preset: 'full-thrust', kind: 'missile' },
      scene.engineImages,
    );
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
  for (const engine of engines) drawControlPoint(ctx, engine.point, controlPointStyle(base.palette, false));
}
