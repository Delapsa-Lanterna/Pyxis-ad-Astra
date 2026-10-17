<template>
  <button
    class="variant-info-button ui-button ui-control-button ui-control-center ui-control-reset"
    aria-label="查看舰船信息"
    aria-haspopup="dialog"
    @mouseenter="show"
    @focus="show"
    @click="show"
    @mouseleave="hover.leave"
    @blur="hover.leave"
    @keydown.esc.stop.prevent="hover.close(true)"
  >
    <ImmersiveResourceIcon :source="infoIcon" fallback="icon_more_info" :color="IMMERSIVE_COLORS.primary" :size="26" label="查看舰船信息" />
  </button>
  <div
    v-if="hover.selected.value"
    :ref="(element) => (hover.surface.value = element as HTMLElement | null)"
    class="variant-ship-tooltip immersive-display-surface ui-content-surface"
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
import type { VariantProjection } from '@/domain/immersive/variant/variant-panel';
import { projectShipPanel } from '@/domain/immersive/ship/ship-panel';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import { useImmersiveHover } from '@/app/composables/use-immersive-hover';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { warningNotice } from '@/shared/lib/errors';
import ShipImmersivePanel from '../ship/ShipImmersivePanel.vue';
import ImmersiveResourceIcon from '../ImmersiveResourceIcon.vue';
import { IMMERSIVE_COLORS } from '@/domain/immersive/appearance';
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
  onFailures: (items) => {
    const missing = items.filter((resource) => resource.key !== 'icon_more_info');
    if (missing.length)
      feedback.warning(warningNotice('舰船详情图片读取失败：' + missing.length, 'resource.read_failed', 'Variant ship information'));
  },
});
const infoRef = computed(() => props.snapshot.referenceSettings.resources.icon_more_info);
const infoIcon = computed(() => (infoRef.value ? (media.dataUrl(props.root.sessionId, infoRef.value) ?? '') : ''));
watch(
  [() => props.root.sessionId, infoRef],
  ([session, resource]) => {
    void media.replaceCollection(session, 'ship-info-button', resource ? [resource] : []);
  },
  { immediate: true },
);
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
