<template>
  <span ref="surface"
    ><ResourceThumbnail
      :session-id="sessionId"
      :resource="resource"
      :url="preload.url(sessionId, resource)"
      :active="active"
      :label="label"
      :width="20"
      :height="20"
  /></span>
</template>
<script setup lang="ts">
import { ref, onMounted, onScopeDispose } from 'vue';
import type { ResourceRef } from '@/shared/types';
import ResourceThumbnail from './ResourceThumbnail.vue';
import { useThumbnailPreload } from '@/app/composables/use-thumbnail-preload';
import { resourceThumbnailRequest } from '@/app/composables/use-resource-thumbnail';
const props = defineProps<{ sessionId: string; resource: ResourceRef; label: string }>();
const surface = ref<HTMLElement | null>(null),
  active = ref(false);
const preload = useThumbnailPreload('配置选项预读');
let observer: IntersectionObserver;
onMounted(() => {
  const root = surface.value!.closest<HTMLElement>('.v-vl,.n-base-select-menu,.n-base-selection');
  root?.setAttribute('data-media-viewport', '');
  observer = new IntersectionObserver(
    (entries) => {
      const intersecting = entries.at(-1)!.isIntersecting,
        bounds = surface.value!.getBoundingClientRect(),
        viewport = root?.getBoundingClientRect();
      active.value = intersecting && (!viewport || (bounds.bottom > viewport.top && bounds.top < viewport.bottom));
      const request = resourceThumbnailRequest(props.sessionId, props.resource, 20, 20);
      preload.prepare(props.sessionId, active.value ? [request] : [], intersecting && !active.value ? [request] : []);
    },
    { root, rootMargin: root ? root.clientHeight + 'px 0px' : '0px' },
  );
  observer.observe(surface.value!);
});
onScopeDispose(() => observer.disconnect());
</script>
