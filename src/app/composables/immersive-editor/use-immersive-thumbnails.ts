import type { ResourceRef } from '@/shared/types';
import type { LoadedWeaponMissile, WeaponImageLayer } from '@/domain/editors/weapon-images';
import type { ImmersiveHullProjection, ImmersiveWingLayout } from '@/domain/immersive/hull-scene';
import { windowImageRuntime, type ThumbnailRequest } from '../use-window-image-runtime';
import { drawWeaponMount } from '@/app/renderers/immersive/weapon-mount';
import { paintImmersiveHullThumbnail } from '@/app/renderers/immersive/hull-scene';

export function weaponThumbnailRequest(
  sessionId: string,
  layers: ReadonlyArray<Pick<WeaponImageLayer, 'resource' | 'origin'>>,
  mountType: string,
  mountSize: string,
  missile: LoadedWeaponMissile | null,
  url?: (resource: ResourceRef) => string,
): ThumbnailRequest {
  const runtime = windowImageRuntime(),
    ratio = window.devicePixelRatio,
    resources = [...layers.map((layer) => layer.resource), ...(missile ? [missile.resource] : [])];
  return {
    key: JSON.stringify([
      'weapon',
      sessionId,
      mountType,
      mountSize,
      missile
        ? [
            runtime.key(sessionId, missile.resource),
            missile.size,
            missile.center,
            missile.offsets,
            missile.angles,
            runtime.revision(sessionId, missile.resource),
          ]
        : null,
      layers.map((layer) => [
        runtime.key(sessionId, layer.resource),
        layer.origin.x,
        layer.origin.y,
        runtime.revision(sessionId, layer.resource),
      ]),
      ratio,
    ]),
    sessionId,
    capture: () => weaponThumbnailRequest(sessionId, layers, mountType, mountSize, missile, url),
    resources,
    url,
    render: (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.round(80 * ratio);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(ratio, ratio);
      ctx.translate(40, 40);
      drawWeaponMount(ctx, mountType, mountSize);
      ctx.imageSmoothingEnabled = false;
      ctx.rotate(Math.PI / 4);
      for (const layer of layers) {
        const bitmap = image(layer.resource);
        if (bitmap)
          ctx.drawImage(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            -bitmap.width * layer.origin.x,
            -bitmap.height * layer.origin.y,
            bitmap.width,
            bitmap.height,
          );
      }
      const bitmap = missile ? image(missile.resource) : null;
      if (missile && bitmap)
        for (let index = 0; index < missile.offsets.length / 2; index++) {
          ctx.save();
          ctx.translate(-missile.offsets[index * 2 + 1]!, -missile.offsets[index * 2]!);
          ctx.rotate((-(missile.angles[index] ?? 0) * Math.PI) / 180);
          ctx.drawImage(bitmap, -missile.center[0], -(missile.size[1] - missile.center[1]), missile.size[0], missile.size[1]);
          ctx.restore();
        }
      return canvas;
    },
  };
}
export function hullThumbnailRequest(
  sessionId: string,
  variant: ImmersiveHullProjection,
  size: number,
  layout?: ImmersiveWingLayout,
  url?: (resource: ResourceRef) => string,
): ThumbnailRequest {
  const runtime = windowImageRuntime(),
    ratio = window.devicePixelRatio;
  function collect(item: ImmersiveHullProjection, parents = new Set<string>()): ImmersiveHullProjection[] {
    if (parents.has(item.key)) return [];
    return [item, ...item.modules.flatMap((module) => collect(module.variant, new Set([...parents, item.key])))];
  }
  const scenes = collect(variant),
    resources = scenes.flatMap((item) => [
      ...(item.hull.sprite ? [item.hull.sprite] : []),
      ...item.weapons.flatMap((weapon) => [
        ...weapon.layers.map((layer) => layer.resource),
        ...(weapon.loadedMissile ? [weapon.loadedMissile.resource] : []),
      ]),
    ]);
  return {
    key: JSON.stringify([
      'hull-thumbnail',
      sessionId,
      size,
      layout,
      scenes.map((item) => [
        item.spec.center,
        item.spec.height,
        item.hull.sprite,
        item.weapons,
        item.modules.map((module) => [module.slot, module.variant.spec.moduleAnchor]),
      ]),
      resources.map((resource) => runtime.revision(sessionId, resource)),
      ratio,
    ]),
    sessionId,
    capture: () => hullThumbnailRequest(sessionId, variant, size, layout, url),
    resources,
    url,
    render: (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.round(size * ratio);
      const context = canvas.getContext('2d')!;
      context.scale(ratio, ratio);
      paintImmersiveHullThumbnail(context, size, variant, image, layout);
      return canvas;
    },
  };
}
