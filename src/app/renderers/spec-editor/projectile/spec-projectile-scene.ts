import type { ProjectileGeometry } from '@/domain/spec-editor/projectile/spec-projectile-model';
import { renderCanvasBase, type CanvasScene } from '../../editors/canvas-scene';
import { centerMarkerStyle, controlPointStyle, outlineStyle } from '../../editors/canvas-styles';
import { drawCrossMarker, drawControlPoint, drawRadiusFill, strokeCanvasOutline } from '../../editors/canvas-visuals';
import type { EngineImages } from '../../editors/engine-renderer';
import { drawProjectileVisual, type ProjectileImages } from '../../editors/projectile-renderer';

export interface SpecProjectileEditorScene {
  engineImages: EngineImages;
  base: CanvasScene;
  geometry: ProjectileGeometry;
  images: ProjectileImages;
}
export function renderSpecProjectileEditorScene(ctx: CanvasRenderingContext2D, scene: SpecProjectileEditorScene): void {
  const { base, geometry: g } = scene;
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
  drawProjectileVisual(
    ctx,
    {
      appearance: g.appearance,
      point: { x: g.appearance.kind === 'ballistic' ? g.body.width / 2 : g.appearance.kind === 'beam' ? -g.body.width / 2 : 0, y: 0 },
      angle: 0,
      length: g.body.width,
      alpha: 1,
      phase: 0,
      fringePhase: 0,
      age: 0,
      engineLevel: 1,
    },
    scene.images,
    scene.engineImages,
  );
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
  for (const engine of engines) drawControlPoint(ctx, engine.point, controlPointStyle(base.palette, false));
}
