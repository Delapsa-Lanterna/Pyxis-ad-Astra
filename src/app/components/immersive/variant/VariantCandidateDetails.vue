<template>
  <div class="variant-candidate-details immersive-display-surface">
    <WeaponImmersivePanel v-if="panel?.kind === 'weapon'" :panel="panel" :render="render" />
    <WingImmersivePanel v-else-if="panel?.kind === 'wing'" :panel="panel" :render="render" />
    <ImmersiveText v-else :text="errorText || '正在读取候选详情'" block />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import { useVariantCandidate } from '@/app/composables/immersive-editor/variant/use-variant-candidate';
import ImmersiveText from '../ImmersiveText.vue';
import WeaponImmersivePanel from '../weapon/WeaponImmersivePanel.vue';
import WingImmersivePanel from '../wing/WingImmersivePanel.vue';
const props = defineProps<{ root: JointEditRoot; kind: 'weapons' | 'wings'; id: string }>();
const { snapshot, errorText, panel, mediaUrl } = useVariantCandidate(
  () => props.root,
  () => props.kind,
  () => props.id,
);
const render = computed<ImmersiveRenderContext>(() => ({
  mode: 'readonly',
  root: snapshot.value?.root ?? props.root,
  records: snapshot.value?.records ?? [],
  mediaUrl,
}));
</script>
