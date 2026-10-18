<template>
  <ResourceThumbnail
    v-if="resource"
    :session-id="sessionId"
    :resource="resource"
    :url="url"
    :active="active"
    :label="label"
    :width="size"
    :height="size"
  />
  <ImmersiveFallbackIcon v-else kind="hullmod" :size="size" :label="label + ' · 缺省图标'" />
</template>
<script setup lang="ts">
import type { ResourceRef } from '@/shared/types';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
import ImmersiveFallbackIcon from '../ImmersiveFallbackIcon.vue';
defineProps<{ sessionId: string; resource: ResourceRef | null | undefined; url: string; active: boolean; label: string; size: number }>();
</script>
