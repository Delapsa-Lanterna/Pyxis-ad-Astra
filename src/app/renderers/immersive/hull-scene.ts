import type { ImmersiveHullProjection, ImmersiveWingLayout } from '@/domain/immersive/hull-scene';
import { immersiveHullPoint } from '@/domain/immersive/hull-scene';
import { IMMERSIVE_COLORS } from '@/domain/immersive/appearance';
import type { ResourceRef } from '@/shared/types';
import { clearCanvas, drawPixelImage } from '@/app/renderers/editors/canvas-drawing';
import { renderMountedWeapons } from '@/app/renderers/editors/weapon-images';

type Image = (resource: ResourceRef) => HTMLImageElement | null;
interface HullPasses {
  beforeHull?: (context: CanvasRenderingContext2D, variant: ImmersiveHullProjection) => void;
  afterWeapons?: (context: CanvasRenderingContext2D, variant: ImmersiveHullProjection) => void;
}
export function paintImmersiveHull(
  context: CanvasRenderingContext2D,
  variant: ImmersiveHullProjection,
  image: Image,
  passes: HullPasses = {},
  parents = new Set<string>(),
) {
  if (parents.has(variant.key)) return;
  const next = new Set([...parents, variant.key]);
  const bitmap = variant.hull.sprite ? image(variant.hull.sprite) : null;
  const center = Array.isArray(variant.spec.center) ? variant.spec.center : [0, 0];
  passes.beforeHull?.(context, variant);
  if (bitmap) drawPixelImage(context, bitmap, -Number(center[0]), -(bitmap.height - Number(center[1])), bitmap.width, bitmap.height);
  renderMountedWeapons(context, {
    weapons: variant.weapons,
    image: (resource) => image(resource) ?? undefined,
    point: (slot) => immersiveHullPoint((Array.isArray(slot.locations) ? slot.locations : [0, 0]).map(Number)),
    rotation: (slot) => (-Number(slot.angle ?? 0) * Math.PI) / 180,
    scale: 1,
    context: 'refit',
    renderModules: () => {
      for (const module of variant.modules) {
        const location = Array.isArray(module.slot.locations) ? module.slot.locations : [0, 0];
        const anchor = Array.isArray(module.variant.spec.moduleAnchor) ? module.variant.spec.moduleAnchor : [0, 0];
        const position = immersiveHullPoint(location.map(Number)),
          attachment = immersiveHullPoint(anchor.map(Number));
        context.save();
        context.translate(position.x, position.y);
        context.rotate((-Number(module.slot.angle ?? 0) * Math.PI) / 180);
        context.translate(-attachment.x, -attachment.y);
        paintImmersiveHull(context, module.variant, image, passes, next);
        context.restore();
      }
    },
  });
  passes.afterWeapons?.(context, variant);
}
export function paintImmersiveHullThumbnail(
  context: CanvasRenderingContext2D,
  size: number,
  variant: ImmersiveHullProjection,
  image: Image,
  layout?: ImmersiveWingLayout,
) {
  clearCanvas(context, size, size, IMMERSIVE_COLORS.background);
  context.save();
  context.translate(size / 2, size / 2);
  if (layout) {
    const sprite = variant.hull.sprite ? image(variant.hull.sprite) : null;
    const center = Array.isArray(variant.spec.center) ? variant.spec.center : [0, 0];
    const scale = layout.spriteHeight / (sprite?.height ?? Number(variant.spec.height));
    for (const point of layout.points) {
      context.save();
      context.translate(point.x, point.y);
      context.scale(scale, scale);
      if (sprite) context.translate(Number(center[0]) - sprite.width / 2, sprite.height / 2 - Number(center[1]));
      paintImmersiveHull(context, variant, image);
      context.restore();
    }
  } else paintImmersiveHull(context, variant, image);
  context.restore();
}
