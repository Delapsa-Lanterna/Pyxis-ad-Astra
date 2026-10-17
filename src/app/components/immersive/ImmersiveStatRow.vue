<template>
  <div
    class="immersive-stat-row ui-layout-grid ui-layout-shrink ui-control-reset ui-layout-row"
    :class="[stat.tone ?? 'highlight', { inline: stat.inline, 'group-gap': stat.gapBefore }]"
  >
    <span class="immersive-stat-row-label ui-layout-shrink ui-text-wrap"
      ><ImmersiveText :text="stat.label + (stat.inline ? '：' : '')"
    /></span>
    <n-popover
      ref="popover"
      v-if="editable && stat.fields.length"
      trigger="manual"
      placement="bottom-end"
      display-directive="if"
      :show="active"
      :to="trigger?.closest<HTMLElement>('[role=dialog]')"
      @update:show="$emit('toggle', $event)"
      :show-arrow="false"
    >
      <template #trigger
        ><button
          ref="trigger"
          type="button"
          class="immersive-stat-value ui-button ui-text-wrap ui-control-reset ui-control-pointer"
          :title="stat.diagnostic || stat.formula || '点击编辑来源参数'"
          @click="$emit('toggle', !active)"
        >
          <ImmersiveText :text="stat.display" :runs="stat.displayRuns" :font="stat.font" /></button
      ></template>
      <ImmersiveFieldPopover
        :stat="stat"
        :values="values!"
        :snapshot="snapshot!"
        :runtime-context="runtimeContext!"
        :active="active"
        @update="$emit('update', $event)"
        @close="$emit('dismiss')"
      />
    </n-popover>
    <strong v-else class="immersive-stat-value ui-text-wrap ui-control-reset ui-control-pointer" :title="stat.diagnostic || stat.formula"
      ><ImmersiveText :text="stat.display" :runs="stat.displayRuns" :font="stat.font"
    /></strong>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onScopeDispose } from 'vue';
import type { ImmersiveStat, ImmersiveFieldChange } from '@/domain/immersive/fields';
import type { JointEditSnapshot, JointValue } from '@/shared/types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import ImmersiveFieldPopover from './ImmersiveFieldPopover.vue';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{
  stat: ImmersiveStat;
  editable: boolean;
  active: boolean;
  values?: Record<string, JointValue>;
  snapshot?: JointEditSnapshot;
  runtimeContext?: SchemaRuntimeContext;
}>();
const trigger = ref<HTMLButtonElement | null>(null),
  popover = ref<{ syncPosition: () => void } | null>(null);
let positionFrame: number | null = null;
function resize() {
  if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
  positionFrame = window.requestAnimationFrame(() => {
    positionFrame = null;
    if (!props.active || !props.editable || props.stat.fields.length === 0) return;
    trigger.value!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    popover.value!.syncPosition();
  });
}
watch(
  () => props.active,
  (active) => {
    window.removeEventListener('resize', resize);
    if (active) window.addEventListener('resize', resize);
    else if (positionFrame !== null) {
      window.cancelAnimationFrame(positionFrame);
      positionFrame = null;
    }
  },
  { immediate: true },
);
onScopeDispose(() => {
  window.removeEventListener('resize', resize);
  if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
});
defineEmits<{ toggle: [show: boolean]; dismiss: []; update: [changes: ImmersiveFieldChange[]] }>();
</script>
