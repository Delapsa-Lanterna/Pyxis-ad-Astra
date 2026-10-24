import type { WeaponFirePreviewDefinition, PreviewResources } from '@/domain/weapon-fire-preview/preview-definition';
import type {
  WeaponFirePreviewProjectileState,
  WeaponFirePreviewBeamState,
  PreviewExplosion,
} from '@/domain/weapon-fire-preview/simulation';
import { num } from '@/shared/lib/starsector';
import { renderCanvasBase, renderCanvasCursor, type CanvasScene } from '../editors/canvas-scene';
import { renderWeaponImages, type WeaponImageScene } from '../editors/weapon-images';
import { drawBeamVisual, drawProjectileVisual, type ProjectileImages } from '../editors/projectile-renderer';
import type { EngineImages } from '../editors/engine-renderer';

export interface WeaponFirePreviewScene {
  base: CanvasScene;
  definition: WeaponFirePreviewDefinition;
  hasWeaponSpec: boolean;
  assets: WeaponImageScene;
  projectiles: WeaponFirePreviewProjectileState[];
  beam: WeaponFirePreviewBeamState;
  effects: PreviewExplosion[];
  images(resources: PreviewResources): ProjectileImages;
  engineImages: EngineImages;
}
function renderTrail(ctx: CanvasRenderingContext2D, projectile: WeaponFirePreviewProjectileState, images: ProjectileImages) {
  for (const trail of projectile.trails) {
    ctx.save();
    ctx.translate(projectile.x, -projectile.y);
    ctx.rotate(-projectile.angle);
    ctx.globalCompositeOperation = trail.style.type === 'GLOW' ? 'lighter' : 'source-over';
    const color = trail.color,
      strip = trail.style.mode === 'QUAD_STRIP';
    const image = images.image(strip ? 'contrailTexture' : 'hitGlow', color);
    const cos = Math.cos(projectile.angle),
      sin = Math.sin(projectile.angle);
    const position = (point: (typeof trail.points)[number]) => {
      const dx = point.x - projectile.x,
        dy = point.y - projectile.y;
      return {
        x: dx * cos + dy * sin + projectile.speed * num(trail.style.contrailMaxSpeedMult) * (projectile.age - point.time),
        y: dx * sin - dy * cos,
      };
    };
    for (let i = 0; i < trail.points.length; i++) {
      const point = trail.points[i]!,
        progress = (projectile.age - point.time) / trail.duration;
      const final = num(trail.style[strip ? 'contrailWidthAddedFractionAtEnd' : 'contrailParticleFinalSizeMult'], 0.5);
      const width = Math.max(0, trail.width * (strip ? 1 + final * progress : 1 + (final - 1) * progress));
      ctx.globalAlpha = (1 - progress) * (Array.isArray(color) ? num(color[3], 255) / 255 : 1);
      const { x, y } = position(point);
      if (!strip && image) ctx.drawImage(image, x - width / 2, y - width / 2, width, width);
      else if (i > 0 && image) {
        const previous = position(trail.points[i - 1]!);
        ctx.drawImage(image, previous.x, y - width / 2, x - previous.x, width);
      }
    }
    ctx.restore();
  }
}
export function renderWeaponFirePreviewScene(ctx: CanvasRenderingContext2D, scene: WeaponFirePreviewScene): void {
  const { center: origin, scale, height } = scene.base;
  renderCanvasBase(ctx, scene.base);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ef444488';
  ctx.beginPath();
  ctx.moveTo(origin.x + scene.definition.range * scale, 40);
  ctx.lineTo(origin.x + scene.definition.range * scale, height - 40);
  ctx.stroke();
  ctx.setLineDash([]);
  if (scene.hasWeaponSpec) renderWeaponImages(ctx, scene.assets);
  else {
    ctx.fillStyle = '#374151';
    ctx.fillRect(origin.x - 18, origin.y - 12, 36, 24);
  }
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(scale, scale);
  const p = scene.definition,
    beam = scene.beam;
  if (p.beam && beam.alpha > 0 && (!p.fullChargeOnly || beam.phase !== 'chargeup'))
    for (const barrel of p.barrels)
      drawBeamVisual(
        ctx,
        {
          appearance: p.appearance,
          point: { x: barrel.x, y: -barrel.y },
          angle: (barrel.angle * Math.PI) / 180,
          length: beam.length,
          alpha: beam.alpha,
          phase: beam.offset,
          fringePhase: beam.fringeOffset,
          age: 0,
          engineLevel: 0,
        },
        scene.images(p.resources),
      );
  for (const projectile of scene.projectiles) {
    const definition = projectile.definition,
      images = scene.images(definition.resources),
      appearance = definition.appearance;
    renderTrail(ctx, projectile, images);
    const fullLength =
      appearance.spawn === 'BEAM' || appearance.spawn === 'BALLISTIC_AS_BEAM'
        ? Math.max(appearance.length, definition.speed / 40)
        : appearance.length;
    const length = Math.max(
      0,
      Math.min(fullLength, projectile.distance) -
        (appearance.spawn === 'BALLISTIC' ? Math.max(0, projectile.age - definition.flightTime) * projectile.speed : 0),
    );
    const level =
      projectile.age < definition.flightTime
        ? 1 - Math.max(0, projectile.age - definition.flightTime + 1) * 0.5
        : projectile.age < definition.flightTime + definition.flameoutTime - definition.noGlowTime
          ? 0.4
          : 0;
    const phase = (-projectile.age * appearance.scroll) / (appearance.kind === 'beam' ? 128 : 1);
    drawProjectileVisual(
      ctx,
      {
        appearance,
        point: { x: projectile.x, y: -projectile.y },
        angle: projectile.angle,
        length,
        alpha: appearance.kind === 'plasma' ? projectile.alpha * Math.min(1, projectile.age * 5) : projectile.alpha,
        phase,
        fringePhase: phase * appearance.fringeScroll,
        age: projectile.age,
        engineLevel: level,
      },
      images,
      scene.engineImages,
    );
  }
  for (const effect of scene.effects) {
    const progress = effect.age / effect.duration,
      images = scene.images(effect.definition.resources);
    const glow = images.image('hitGlow', Array.isArray(effect.color) ? effect.color.map(Number) : [255, 255, 255, 255]);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1 - progress;
    if (glow) {
      const radius = effect.radius * progress;
      ctx.drawImage(glow, effect.x - radius, -effect.y - radius, radius * 2, radius * 2);
      for (const particle of effect.particles)
        ctx.drawImage(
          glow,
          effect.x + particle.x * effect.radius * progress - particle.size / 2,
          -effect.y + particle.y * effect.radius * progress - particle.size / 2,
          particle.size,
          particle.size,
        );
    }
    ctx.restore();
  }
  ctx.restore();
  renderCanvasCursor(ctx, scene.base);
}
