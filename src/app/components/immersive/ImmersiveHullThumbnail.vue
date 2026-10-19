<template>
  <div class="variant-scene ui-layout-clip">
    <canvas ref="canvas" class="variant-scene-canvas ui-canvas-image" role="img" :aria-label="variant.name + ' 舰船与槽位预览'" />
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { ImmersiveHullProjection, ImmersiveWingLayout } from '@/domain/immersive/hull-scene';
import type { ResourceRef } from '@/shared/types';
import { useResourceThumbnail } from '@/app/composables/use-resource-thumbnail';
import { hullThumbnailRequest } from '@/app/composables/immersive-editor/use-immersive-thumbnails';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
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
  feedback = useAppFeedback();
useResourceThumbnail(
  canvas,
  () => hullThumbnailRequest(props.sessionId, props.variant, props.size, props.wingLayout, props.resourceUrl),
  () => props.active,
  (error) => feedback.error(error, '读取装配缩略图失败'),
);
</script>
