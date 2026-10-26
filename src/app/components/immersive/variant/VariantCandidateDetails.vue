<template>
  <div
    class="variant-candidate-details immersive-display-surface ui-content-surface"
    :class="{ 'variant-module-details': kind === 'variants' }"
  >
    <ShipImmersivePanel v-if="currentVariant && currentSnapshot" :panel="currentPanel!" :render="currentRender!" />
    <WeaponImmersivePanel v-else-if="panel?.kind === 'weapon'" :panel="panel" :render="render" />
    <WingImmersivePanel v-else-if="panel?.kind === 'wing'" :panel="panel" :render="render" />
    <ShipImmersivePanel v-else-if="panel?.kind === 'ship'" :panel="panel" :render="render" />
    <ImmersiveText v-else :text="errorText || (kind === 'variants' && snapshot ? '装配或船体来源缺失' : '正在读取候选详情')" block />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { JointEditRoot, JointEditSnapshot, JointValue } from '@/shared/types';
import type { VariantProjection } from '@/domain/immersive/variant/variant-panel';
import { projectShipPanel } from '@/domain/immersive/ship/ship-panel';
import ShipImmersivePanel from '../ship/ShipImmersivePanel.vue';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import { useVariantCandidate } from '@/app/composables/immersive-editor/variant/use-variant-candidate';
import ImmersiveText from '../ImmersiveText.vue';
import WeaponImmersivePanel from '../weapon/WeaponImmersivePanel.vue';
import WingImmersivePanel from '../wing/WingImmersivePanel.vue';
const props = defineProps<{
  root: JointEditRoot;
  kind: 'weapons' | 'wings' | 'variants';
  id: string;
  currentVariant?: VariantProjection;
  currentSnapshot?: JointEditSnapshot;
  currentValues?: Record<string, JointValue>;
  currentRender?: ImmersiveRenderContext;
}>();
const currentPanel = computed(() =>
  props.currentSnapshot && props.currentVariant
    ? projectShipPanel(props.currentSnapshot, props.currentValues!, props.currentSnapshot, props.currentVariant)
    : null,
);
const { snapshot, errorText, panel, mediaUrl } = useVariantCandidate(
  () => props.root,
  () => props.kind,
  () => (props.currentVariant ? '' : props.id),
);
const render = computed<ImmersiveRenderContext>(() => ({
  mode: 'readonly',
  root: snapshot.value?.root ?? props.root,
  records: snapshot.value?.records ?? [],
  mediaUrl,
}));
</script>
