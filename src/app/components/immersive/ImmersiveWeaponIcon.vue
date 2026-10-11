<template><canvas ref="canvas" class="immersive-weapon-icon" width="80" height="80" role="img" :aria-label="label" /></template>
<script setup lang="ts">
import { ref, watch, onScopeDispose } from 'vue';
import type { WeaponPanel } from '@/domain/immersive/weapon-panel';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { drawWeaponMount } from '@/domain/immersive/weapon-icon';
const props = defineProps<{
  layers: WeaponPanel['iconLayers'];
  url: (resource: WeaponPanel['iconLayers'][number]['resource']) => string;
  label: string;
  mountType: string;
  mountSize: string;
  loadedMissile?: WeaponPanel['loadedMissile'];
}>();
const canvas = ref<HTMLCanvasElement | null>(null),
  reads = useQueryReadOwner(),
  feedback = useAppFeedback();
type IconLayer = WeaponPanel['iconLayers'][number] & { url: string; missile: boolean };
let decodedImages: Array<{ image: HTMLImageElement; layer: IconLayer }> = [];
function paint() {
  const surface = canvas.value;
  if (!surface) return;
  const ratio = window.devicePixelRatio;
  surface.width = Math.round(80 * ratio);
  surface.height = Math.round(80 * ratio);
  const ctx = surface.getContext('2d')!;
  ctx.scale(ratio, ratio);
  ctx.translate(40, 40);
  drawWeaponMount(ctx, props.mountType, props.mountSize);
  ctx.imageSmoothingEnabled = false;
  ctx.rotate(Math.PI / 4);
  const missile = props.loadedMissile;
  for (const { image, layer } of decodedImages) {
    if (layer.missile && missile) {
      for (let index = 0; index < missile.offsets.length / 2; index++) {
        ctx.save();
        ctx.translate(-missile.offsets[index * 2 + 1]!, -missile.offsets[index * 2]!);
        ctx.rotate((-(missile.angles[index] ?? 0) * Math.PI) / 180);
        ctx.drawImage(image, -missile.center[0], -(missile.size[1] - missile.center[1]), missile.size[0], missile.size[1]);
        ctx.restore();
      }
    } else
      ctx.drawImage(
        image,
        0,
        0,
        image.width,
        image.height,
        -image.width * layer.origin.x,
        -image.height * layer.origin.y,
        image.width,
        image.height,
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
  () => {
    reads.revoke();
    decodedImages = [];
    paint();
    if (!canvas.value) return;
    const missile = props.loadedMissile;
    const sources = [
      ...props.layers.map((layer) => ({ ...layer, url: props.url(layer.resource), missile: false })),
      ...(missile ? [{ resource: missile.resource, origin: { x: 0, y: 0 }, url: props.url(missile.resource), missile: true }] : []),
    ].filter((layer) => layer.url);
    void reads.consume(
      'icon',
      { sources },
      () =>
        Promise.all(
          sources.map(
            (layer) =>
              new Promise<{ image: HTMLImageElement; layer: typeof layer }>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve({ image, layer });
                image.onerror = () => reject(new Error('武器贴图解码失败'));
                image.src = layer.url;
              }),
          ),
        ),
      {
        ready: (images) => {
          decodedImages = images;
          paint();
        },
        error: (error) => feedback.error(error, '读取武器图标失败'),
      },
    );
  },
  { flush: 'post' },
);
window.addEventListener('resize', paint);
onScopeDispose(() => {
  reads.revoke();
  decodedImages = [];
  window.removeEventListener('resize', paint);
});
</script>
