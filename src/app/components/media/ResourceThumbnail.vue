<template><canvas ref="surface" role="img" :aria-label="label" :style="{ width: width + 'px', height: height + 'px' }" /></template>
<script setup lang="ts">
import { ref } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { resourceThumbnailRequest, useResourceThumbnail } from '@/app/composables/use-resource-thumbnail';
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
  feedback = useAppFeedback();
useResourceThumbnail(
  surface,
  () => resourceThumbnailRequest(props.sessionId, props.resource, props.width, props.height, props.url),
  () => props.active,
  (error) => feedback.error(error, '读取缩略图失败'),
);
</script>
