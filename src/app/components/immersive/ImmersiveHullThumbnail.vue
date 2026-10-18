<template>
  <div class="variant-scene ui-layout-clip">
    <canvas ref="canvas" class="variant-scene-canvas ui-canvas-image" role="img" :aria-label="variant.name + ' 舰船与槽位预览'" />
  </div>
</template>
<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ImmersiveHullProjection, ImmersiveWingLayout } from '@/domain/immersive/hull-scene';
import type { ResourceRef } from '@/shared/types';
import { useResourceImages } from '@/app/composables/use-resource-images';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { windowImageCache } from '@/app/composables/use-window-image-cache';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { paintImmersiveHullThumbnail } from '@/app/renderers/immersive/hull-scene';
const props = withDefaults(
  defineProps<{
    variant: ImmersiveHullProjection;
    sessionId: string;
    size: number;
    wingLayout?: ImmersiveWingLayout;
    resourceUrl?: (resource: ResourceRef) => string;
    active?: boolean;
  }>(),
  { active: true, wingLayout: undefined, resourceUrl: undefined },
);
const canvas = ref<HTMLCanvasElement | null>(null),
  cache = windowImageCache(),
  feedback = useAppFeedback();
function variants(root: ImmersiveHullProjection, parents = new Set<string>()): ImmersiveHullProjection[] {
  if (parents.has(root.key)) return [];
  return [root, ...root.modules.flatMap((module) => variants(module.variant, new Set([...parents, root.key])))];
}
const scenes = computed(() => variants(props.variant));
const resources = computed(() =>
  scenes.value.flatMap((variant) => [
    ...(variant.hull.sprite ? [variant.hull.sprite] : []),
    ...variant.weapons.flatMap((weapon) => [
      ...weapon.layers.map((layer) => layer.resource),
      ...(weapon.loadedMissile ? [weapon.loadedMissile.resource] : []),
    ]),
  ]),
);
const media = props.resourceUrl
  ? null
  : useResourceMediaRegistry({ surface: '装配缩略图', onError: feedback.error, onFailures: () => undefined });
watch(
  () => [props.active, resources.value] as const,
  () => {
    if (media) void media.replaceCollection(props.sessionId, 'thumbnail', props.active ? resources.value : []);
  },
  { immediate: true },
);
const url = (resource: ResourceRef) =>
  props.resourceUrl ? props.resourceUrl(resource) : (media!.dataUrl(props.sessionId, resource) ?? '');
const decoded = useResourceImages(
  () => props.sessionId,
  () => resources.value.map((resource) => ({ resource, url: url(resource) })),
  paint,
  (error) => feedback.error(error, '读取装配缩略图失败'),
  () => props.active,
);
const signature = computed(() =>
  JSON.stringify([
    'hull-thumbnail',
    props.sessionId,
    props.size,
    props.wingLayout,
    scenes.value.map((variant) => [
      variant.spec.center,
      variant.hull.sprite,
      variant.weapons,
      variant.modules.map((module) => [module.slot, module.variant.spec.moduleAnchor]),
    ]),
    resources.value.map((resource) => cache.revision(props.sessionId, resource)),
  ]),
);
let release: (() => void) | null = null;
function paint() {
  const surface = canvas.value;
  if (!surface || !props.active) return;
  const ratio = window.devicePixelRatio,
    key = signature.value + '/' + ratio;
  const cached = cache.thumbnail(key);
  if (!cached && !decoded.ready()) return;
  release?.();
  const finished = cached ?? document.createElement('canvas');
  if (!cached) {
    finished.width = finished.height = Math.round(props.size * ratio);
    const context = finished.getContext('2d')!;
    context.scale(ratio, ratio);
    paintImmersiveHullThumbnail(context, props.size, props.variant, decoded.image, props.wingLayout);
  }
  release = cached ? cache.retainThumbnail(key) : cache.storeThumbnail(key, props.sessionId, resources.value, finished);
  surface.width = finished.width;
  surface.height = finished.height;
  surface.getContext('2d')!.drawImage(finished, 0, 0);
}
watch(
  () => [canvas.value, props.active, signature.value],
  () => {
    if (props.active) paint();
    else {
      release?.();
      release = null;
    }
  },
  { flush: 'post' },
);
window.addEventListener('resize', paint);
onScopeDispose(() => {
  release?.();
  window.removeEventListener('resize', paint);
});
</script>
