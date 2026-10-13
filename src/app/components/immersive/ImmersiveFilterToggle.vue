<template>
  <button
    class="immersive-filter-toggle"
    role="checkbox"
    :aria-checked="checked"
    :aria-label="label"
    :class="{ selected: checked }"
    :style="appearance"
    @click="$emit('toggle', $event)"
  >
    <ImmersiveText :text="text" :font="font" ink-aligned outlined />
  </button>
</template>
<script setup lang="ts">
import type { ImmersiveFontRole } from '@/domain/immersive/font-roles';
import { computed } from 'vue';
import ImmersiveText from './ImmersiveText.vue';
const props = withDefaults(defineProps<{ text: string; label: string; checked: boolean; font?: ImmersiveFontRole; color?: string }>(), {
  font: 'body',
  color: undefined,
});
const appearance = computed(() => {
  if (!props.color) return undefined;
  const rgb = [1, 3, 5].map((offset) => parseInt(props.color!.slice(offset, offset + 2), 16));
  const dark = `rgba(${rgb.map((value) => Math.round(value * 0.4)).join(',')},${175 / 255})`;
  return {
    color: `rgb(${rgb.map((value) => Math.round(value * 0.65 + 255 * 0.35)).join(',')})`,
    borderColor: dark,
    backgroundColor: props.checked ? dark : 'rgba(0,0,0,0.67)',
  };
});
defineEmits<{ toggle: [event: MouseEvent] }>();
</script>
