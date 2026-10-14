<template><canvas ref="surface" role="img" :aria-label="label" :style="{ width: width + 'px', height: height + 'px' }" /></template>
<script setup lang="ts">
import { ref, watch, onMounted, onScopeDispose } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { useResourceImages } from '@/app/composables/use-resource-images';
import { windowImageCache } from '@/app/composables/use-window-image-cache';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
const props = withDefaults(
  defineProps<{
    sessionId: string;
    resource: ResourceRef;
    url: string;
    label: string;
    width?: number;
    height?: number;
    active?: boolean;
  }>(),
  { width: 32, height: 32, active: true },
);
const surface = ref<HTMLCanvasElement | null>(null),
  cache = windowImageCache(),
  feedback = useAppFeedback();
const source = () => [{ resource: props.resource, url: props.url }];
const decoded = useResourceImages(
  () => props.sessionId,
  source,
  paint,
  (error) => feedback.error(error, '读取缩略图失败'),
  () => props.active,
);
let release: (() => void) | null = null;
function paint() {
  const canvas = surface.value;
  if (!canvas || !props.active) return;
  const ratio = window.devicePixelRatio,
    key = JSON.stringify([
      'thumbnail',
      cache.key(props.sessionId, props.resource),
      cache.revision(props.sessionId, props.resource),
      props.width,
      props.height,
      ratio,
    ]);
  const cached = cache.thumbnail(key),
    hold = cached ? cache.retainThumbnail(key) : null;
  release?.();
  release = hold;
  canvas.width = Math.round(props.width * ratio);
  canvas.height = Math.round(props.height * ratio);
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  if (cached) {
    context.drawImage(cached, 0, 0);
    return;
  }
  const image = decoded.image(props.resource);
  if (!image) return;
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height),
    width = Math.round(image.width * scale),
    height = Math.round(image.height * scale);
  context.drawImage(image, Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2), width, height);
  const finished = document.createElement('canvas');
  finished.width = canvas.width;
  finished.height = canvas.height;
  finished.getContext('2d')!.drawImage(canvas, 0, 0);
  release = cache.storeThumbnail(key, props.sessionId, [props.resource], finished);
}
watch(
  () => [surface.value, props.width, props.height, props.active, cache.revision(props.sessionId, props.resource)],
  () => {
    if (!props.active) {
      release?.();
      release = null;
    } else paint();
  },
  { flush: 'post' },
);
onMounted(() => window.addEventListener('resize', paint));
onScopeDispose(() => {
  release?.();
  window.removeEventListener('resize', paint);
});
</script>
