<template>
  <div class="variant-wing-icon" :style="{ width: size + 'px', height: size + 'px' }" :title="layout.diagnostic">
    <VariantScene
      v-if="variant && !layout.diagnostic"
      :variant="variant"
      :session-id="root.sessionId"
      :icon-size="size"
      :wing-layout="layout"
    />
    <ImmersiveText v-else-if="variant" text="编队来源缺失" font="caption" />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import { useVariantCandidate } from '@/app/composables/use-variant-candidate';
import { variantSnapshotScene } from '@/domain/immersive/variant-panel';
import { variantWingLayout } from '@/domain/immersive/variant-scene';
import { jointObject } from '@/domain/joint-edit';
import { weaponNumber } from '@/domain/immersive/weapon-statistics';
import { schemaStringValue } from '@/domain/schema/schema-values';
import VariantScene from './VariantScene.vue';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{ root: JointEditRoot; id: string; size: number; rendererSize: number }>();
const { snapshot, values } = useVariantCandidate(
  () => props.root,
  () => 'wings',
  () => props.id,
);
const variant = computed(() => (snapshot.value ? variantSnapshotScene(snapshot.value, values.value) : null));
const layout = computed(() => {
  const wing = jointObject(snapshot.value ? values.value[snapshot.value.bindings.csv!] : undefined);
  return variantWingLayout(weaponNumber(wing, 'num', NaN), schemaStringValue(wing.formation), props.rendererSize);
});
</script>
