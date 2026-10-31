<template><canvas ref="canvas" class="immersive-weapon-icon" width="80" height="80" role="img" :aria-label="label" /></template>
<script setup lang="ts">
import { ref } from 'vue';
import type { ResourceRef } from '@/shared/types';
import type { LoadedWeaponMissile } from '@/shared/lib/starsector/weapon-images';
import { useResourceThumbnail } from '@/app/composables/use-resource-thumbnail';
import { weaponThumbnailRequest } from '@/app/composables/immersive-editor/use-immersive-thumbnails';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
const props = withDefaults(
  defineProps<{
    layers: Array<{ resource: ResourceRef; origin: { x: number; y: number } }>;
    url: (resource: ResourceRef) => string;
    label: string;
    mountType: string;
    mountSize: string;
    loadedMissile?: LoadedWeaponMissile | null;
    sessionId: string;
    active?: boolean;
  }>(),
  { active: true, loadedMissile: null },
);
const canvas = ref<HTMLCanvasElement | null>(null),
  feedback = useAppFeedback();
useResourceThumbnail(
  canvas,
  () => weaponThumbnailRequest(props.sessionId, props.layers, props.mountType, props.mountSize, props.loadedMissile, props.url),
  () => props.active,
  (error) => feedback.error(error, '读取武器图标失败'),
);
</script>
