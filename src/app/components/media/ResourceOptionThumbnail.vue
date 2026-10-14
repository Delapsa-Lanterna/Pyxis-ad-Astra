<template>
  <span ref="surface"
    ><ResourceThumbnail
      :session-id="sessionId"
      :resource="resource"
      :url="media.dataUrl(sessionId, resource) ?? ''"
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
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { warningNotice } from '@/shared/lib/errors';
import { useImagePreload } from '@/app/composables/use-image-preload';
const props = defineProps<{ sessionId: string; resource: ResourceRef; label: string }>();
const surface = ref<HTMLElement | null>(null),
  active = ref(false),
  feedback = useAppFeedback();
const media = useResourceMediaRegistry({
  surface: '配置选项',
  onError: feedback.error,
  onFailures: (resources) =>
    feedback.warning(warningNotice('读取选项图片失败：' + resources.length, 'resource.read_failed', 'Schema option')),
});
const preload = useImagePreload('配置选项预读', media);
let observer: IntersectionObserver;
onMounted(() => {
  const root = surface.value!.closest<HTMLElement>('.v-vl,.n-base-select-menu,.n-base-selection');
  observer = new IntersectionObserver(
    (entries) => {
      const intersecting = entries.at(-1)!.isIntersecting,
        bounds = surface.value!.getBoundingClientRect(),
        viewport = root?.getBoundingClientRect();
      active.value = intersecting && (!viewport || (bounds.bottom > viewport.top && bounds.top < viewport.bottom));
      preload.prepare(props.sessionId, active.value ? [props.resource] : [], intersecting && !active.value ? [props.resource] : []);
    },
    { root, rootMargin: root ? root.clientHeight + 'px 0px' : '0px' },
  );
  observer.observe(surface.value!);
});
onScopeDispose(() => observer.disconnect());
</script>
