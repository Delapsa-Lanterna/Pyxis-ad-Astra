import type { Point } from '@/domain/editors/editor-types';
import type { CanvasPalette } from '@/domain/editors/lib/canvas-palette';
import type { WeaponPreviewParams, ProjectilePreviewState, BeamPreviewState, BarrelState } from '@/domain/editors/weapon-preview';
import { rgba } from '@/shared/lib/starsector';
import { clearCanvas } from './canvas-drawing';
import { renderWeaponImages, type WeaponImageScene } from './weapon-images';
export interface WeaponPreviewScene {
  size: { width: number; height: number };
  palette: CanvasPalette;
  params: WeaponPreviewParams;
  origin: Point;
  range: number;
  scale: number;
  hasWeaponSpec: boolean;
  assets: WeaponImageScene;
  barrels: BarrelState[];
  projectiles: ProjectilePreviewState[];
  beam: BeamPreviewState;
}
function renderPreviewWeapon(ctx: CanvasRenderingContext2D, scene: WeaponPreviewScene) {
  const origin = scene.origin;
  if (!scene.hasWeaponSpec) {
    ctx.fillStyle = '#374151';
    ctx.fillRect(origin.x - 18, origin.y - 12, 36, 24);
    ctx.strokeStyle = '#9ca3af';
    ctx.strokeRect(origin.x - 18, origin.y - 12, 36, 24);
    return;
  }
  renderWeaponImages(ctx, scene.assets);
}
export function renderWeaponPreviewScene(ctx: CanvasRenderingContext2D, scene: WeaponPreviewScene): void {
  const dimensions = scene.size;
  const p = scene.params;
  const end = scene.origin.x + scene.range;
  clearCanvas(ctx, dimensions.width, dimensions.height, scene.palette.background);
  ctx.strokeStyle = scene.palette.grid;
  for (let x = 80; x < dimensions.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, dimensions.height);
    ctx.stroke();
  }
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ef444488';
  ctx.beginPath();
  ctx.moveTo(end, 40);
  ctx.lineTo(end, dimensions.height - 40);
  ctx.stroke();
  ctx.setLineDash([]);
  renderPreviewWeapon(ctx, scene);
  if (p.specClass === 'beam' && scene.beam.alpha > 0) {
    const beamLength = (p.beamSpeed > 0 ? scene.beam.length : p.range) * scene.scale;
    const bw = Math.max(1, p.beamWidth * scene.scale * 0.15);
    for (let i = 0; i < scene.barrels.length; i++) {
      const barrel = scene.barrels[i];
      if (!barrel) continue;
      ctx.save();
      ctx.translate(barrel.x, barrel.y);
      ctx.rotate((-barrel.angle * Math.PI) / 180);
      ctx.globalAlpha = scene.beam.alpha;
      ctx.fillStyle = rgba(p.fringeColor, 0.65);
      ctx.fillRect(0, -bw, beamLength, bw * 2);
      ctx.fillStyle = rgba(p.coreColor, 0.9);
      ctx.fillRect(0, -bw * 0.4, beamLength, bw * 0.8);
      ctx.restore();
    }
  }
  for (const o of scene.projectiles) {
    if (o.exploding) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, p.explosionRadius * scene.scale * 0.1 * o.explosionAge * 4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.explosionColor, 0.5);
      ctx.fill();
      continue;
    }
    if (o.trail?.length > 1) {
      ctx.beginPath();
      ctx.moveTo(o.trail[0]!.x, o.trail[0]!.y);
      for (const t of o.trail) ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = '#f59e0b66';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(-o.angle);
    ctx.fillStyle = o.missile ? '#9ca3af' : rgba(p.projFringeColor, 0.8);
    ctx.fillRect(
      -p.projLength * scene.scale * 0.08,
      -Math.max(2, p.projWidth * scene.scale * 0.1),
      p.projLength * scene.scale * 0.16,
      Math.max(3, p.projWidth * scene.scale * 0.2),
    );
    ctx.fillStyle = o.missile ? '#ef4444' : rgba(p.projCoreColor, 0.95);
    ctx.fillRect(0, -1, Math.max(4, p.projLength * scene.scale * 0.08), 2);
    ctx.restore();
  }
}
