<template>
  <div class="variant-wing-icon ui-layout-clip" :style="{ width: size + 'px', height: size + 'px' }" :title="layout.diagnostic">
    <ImmersiveHullThumbnail
      v-if="variant && !layout.diagnostic"
      :variant="variant"
      :session-id="root.sessionId"
      :size="size"
      :wing-layout="layout"
    />
    <ImmersiveText v-else-if="variant" text="编队来源缺失" font="caption" />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import { useVariantCandidate } from '@/app/composables/immersive-editor/variant/use-variant-candidate';
import { immersiveSnapshotScene } from '@/domain/immersive/hull-scene';
import { immersiveWingLayout } from '@/domain/immersive/hull-scene';
import { jointObject } from '@/domain/joint-edit';
import { immersiveNumber } from '@/domain/immersive/fields';
import { schemaStringValue } from '@/domain/schema/schema-values';
import ImmersiveHullThumbnail from '../ImmersiveHullThumbnail.vue';
import ImmersiveText from '../ImmersiveText.vue';
const props = defineProps<{ root: JointEditRoot; id: string; size: number; rendererSize: number }>();
const { snapshot, values } = useVariantCandidate(
  () => props.root,
  () => 'wings',
  () => props.id,
);
const variant = computed(() => (snapshot.value ? immersiveSnapshotScene(snapshot.value, values.value) : null));
const layout = computed(() => {
  const wing = jointObject(snapshot.value ? values.value[snapshot.value.bindings.csv!] : undefined);
  return immersiveWingLayout(immersiveNumber(wing, 'num', NaN), schemaStringValue(wing.formation), props.rendererSize);
});
</script>
