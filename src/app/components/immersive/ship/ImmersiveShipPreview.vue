<template>
  <div class="ship-immersive-sprite" :style="{ width: size + 'px', height: size + 'px' }">
    <img v-if="url" :src="url" :alt="label" :style="{ width: width + 'px', height: height + 'px' }" @load="loaded" /><ImmersiveText
      v-else
      text="贴图暂无可用内容"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ImmersiveText from '../ImmersiveText.vue';
const props = withDefaults(defineProps<{ url: string; label: string; hullSize: string; size?: number }>(), { size: 200 });
const natural = ref({ width: 0, height: 0 });
watch(
  () => props.url,
  () => {
    natural.value = { width: 0, height: 0 };
  },
);
function loaded(event: Event) {
  const image = event.target as HTMLImageElement;
  natural.value = { width: image.naturalWidth, height: image.naturalHeight };
}
const scale = computed(
  () =>
    Math.min(1, props.size / (natural.value.width || props.size), props.size / (natural.value.height || props.size)) *
    ({ FIGHTER: 0.75, FRIGATE: 0.5, DESTROYER: 0.55, CRUISER: 0.7, CAPITAL_SHIP: 1 }[props.hullSize] ?? 1) *
    0.95,
);
const width = computed(() => natural.value.width * scale.value),
  height = computed(() => natural.value.height * scale.value);
</script>
