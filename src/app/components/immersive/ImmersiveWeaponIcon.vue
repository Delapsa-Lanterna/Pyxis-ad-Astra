<template><canvas ref="canvas" class="immersive-weapon-icon" width="80" height="80" role="img" :aria-label="label" /></template>
<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue';
import type { WeaponPanel } from '@/domain/immersive/weapon-panel';
import { useResourceImages } from '@/app/composables/use-resource-images';
import { windowImageCache } from '@/app/composables/use-window-image-cache';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { drawWeaponMount } from '@/domain/immersive/weapon-icon';
const props = defineProps<{
  layers: WeaponPanel['iconLayers'];
  url: (resource: WeaponPanel['iconLayers'][number]['resource']) => string;
  label: string;
  mountType: string;
  mountSize: string;
  loadedMissile?: WeaponPanel['loadedMissile'];
  sessionId: string;
}>();
const canvas = ref<HTMLCanvasElement | null>(null),
  feedback = useAppFeedback(),
  cache = windowImageCache();
const sources = () => [
  ...props.layers.map((layer) => ({ ...layer, url: props.url(layer.resource), missile: false })),
  ...(props.loadedMissile
    ? [
        {
          resource: props.loadedMissile.resource,
          origin: { x: 0, y: 0 },
          phase: 'body' as const,
          url: props.url(props.loadedMissile.resource),
          missile: true,
        },
      ]
    : []),
];
const { image, ready } = useResourceImages(
  () => props.sessionId,
  sources,
  () => paint(),
  (error) => feedback.error(error, '读取武器图标失败'),
);
let releaseThumbnail: (() => void) | null = null;
const signature = computed(() =>
  JSON.stringify([
    'weapon',
    props.sessionId,
    props.mountType,
    props.mountSize,
    props.loadedMissile
      ? [
          cache.key(props.sessionId, props.loadedMissile.resource),
          props.loadedMissile.size,
          props.loadedMissile.center,
          props.loadedMissile.offsets,
          props.loadedMissile.angles,
          cache.revision(props.sessionId, props.loadedMissile.resource),
        ]
      : null,
    props.layers.map((layer) => [
      cache.key(props.sessionId, layer.resource),
      layer.origin.x,
      layer.origin.y,
      cache.revision(props.sessionId, layer.resource),
    ]),
  ]),
);
function thumbnailKey() {
  return signature.value + '/' + window.devicePixelRatio;
}
function paint() {
  const surface = canvas.value;
  if (!surface) return;
  const ratio = window.devicePixelRatio;
  surface.width = Math.round(80 * ratio);
  surface.height = Math.round(80 * ratio);
  const ctx = surface.getContext('2d')!;
  const key = thumbnailKey(),
    cached = cache.thumbnail(key);
  const nextRelease = cached ? cache.retainThumbnail(key) : null;
  releaseThumbnail?.();
  releaseThumbnail = null;
  if (cached) {
    releaseThumbnail = nextRelease;
    ctx.drawImage(cached, 0, 0);
    return;
  }
  ctx.scale(ratio, ratio);
  ctx.translate(40, 40);
  drawWeaponMount(ctx, props.mountType, props.mountSize);
  ctx.imageSmoothingEnabled = false;
  ctx.rotate(Math.PI / 4);
  const missile = props.loadedMissile;
  for (const layer of sources()) {
    const bitmap = image(layer.resource);
    if (!bitmap) continue;
    if (layer.missile && missile) {
      for (let index = 0; index < missile.offsets.length / 2; index++) {
        ctx.save();
        ctx.translate(-missile.offsets[index * 2 + 1]!, -missile.offsets[index * 2]!);
        ctx.rotate((-(missile.angles[index] ?? 0) * Math.PI) / 180);
        ctx.drawImage(bitmap, -missile.center[0], -(missile.size[1] - missile.center[1]), missile.size[0], missile.size[1]);
        ctx.restore();
      }
    } else
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
  if (ready() && props.layers.length) {
    const finished = document.createElement('canvas');
    finished.width = surface.width;
    finished.height = surface.height;
    finished.getContext('2d')!.drawImage(surface, 0, 0);
    releaseThumbnail = cache.storeThumbnail(
      key,
      props.sessionId,
      sources().map((layer) => layer.resource),
      finished,
    );
  }
}
watch(
  () => [
    canvas.value,
    props.mountType,
    props.mountSize,
    props.loadedMissile,
    ...props.layers.map((layer) => props.url(layer.resource)),
    props.loadedMissile ? props.url(props.loadedMissile.resource) : '',
  ],
  paint,
  { flush: 'post' },
);
window.addEventListener('resize', paint);
onScopeDispose(() => {
  releaseThumbnail?.();
  window.removeEventListener('resize', paint);
});
</script>
