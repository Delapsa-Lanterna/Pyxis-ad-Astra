<template>
  <button
    class="variant-info-button"
    aria-label="查看舰船信息"
    aria-haspopup="dialog"
    @mouseenter="show"
    @focus="show"
    @click="show"
    @mouseleave="hover.leave"
    @blur="hover.leave"
    @keydown.esc.stop.prevent="hover.close(true)"
  >
    <ImmersiveText text="?" font="ship-title" ink-aligned />
  </button>
  <div
    v-if="hover.selected.value"
    :ref="(element) => (hover.surface.value = element as HTMLElement | null)"
    class="variant-ship-tooltip immersive-display-surface"
    role="dialog"
    aria-label="舰船只读信息"
    tabindex="-1"
    :style="hover.position.value"
    @mouseenter="hover.keep"
    @mouseleave="hover.leave"
    @focusin="hover.keep"
    @focusout="hover.leave"
    @keydown.esc.stop.prevent="hover.close(true)"
  >
    <div class="variant-ship-content"><ShipImmersivePanel :panel="panel!" :render="render" /></div>
  </div>
</template>
<script setup lang="ts">
import { computed, watch } from 'vue';
import type { JointEditRoot, JointEditSnapshot, JointValue } from '@/shared/types';
import type { VariantProjection } from '@/domain/immersive/variant-panel';
import { projectShipPanel } from '@/domain/immersive/ship-panel';
import type { ImmersiveRenderContext } from './immersive-render-context';
import { useImmersiveHover } from '@/app/composables/use-immersive-hover';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { warningNotice } from '@/shared/lib/errors';
import ShipImmersivePanel from './ShipImmersivePanel.vue';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{
  variant: VariantProjection;
  snapshot: JointEditSnapshot;
  values: Record<string, JointValue>;
  root: JointEditRoot;
}>();
const hover = useImmersiveHover<string>(
  () => 832,
  () => 'left',
);
const panel = computed(() => (hover.selected.value ? projectShipPanel(props.snapshot, props.values, props.snapshot, props.variant) : null));
const feedback = useAppFeedback();
const media = useResourceMediaRegistry({
  surface: '装配舰船详情',
  onError: feedback.error,
  onFailures: (items) =>
    feedback.warning(warningNotice('舰船详情图片读取失败：' + items.length, 'resource.read_failed', 'Variant ship information')),
});
const render = computed<ImmersiveRenderContext>(() => ({
  mode: 'readonly',
  root: props.root,
  records: props.snapshot.records,
  mediaUrl: (resource) => media.dataUrl(props.root.sessionId, resource) ?? '',
}));
watch(
  () => panel.value?.sprite,
  (sprite) => {
    void media.replaceCollection(props.root.sessionId, 'ship-info', sprite ? [sprite] : []);
  },
);
watch([() => props.variant.key, () => props.root.sessionId, () => props.root.modRoot, () => props.root.kind, () => props.root.id], () =>
  hover.close(),
);
function show(event: MouseEvent | FocusEvent) {
  hover.show(
    props.variant.key,
    event.currentTarget as HTMLElement,
    event.type === 'click' ? 'click' : event.type === 'focus' ? 'focus' : 'hover',
  );
}
</script>
