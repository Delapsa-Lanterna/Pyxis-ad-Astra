<template>
  <span
    class="immersive-resource-icon"
    role="img"
    :aria-label="label"
    :style="{
      width: size + 'px',
      height: size + 'px',
      color,
      backgroundColor: image ? color : undefined,
      maskImage: image ? 'url(' + JSON.stringify(image) + ')' : undefined,
    }"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import checkmark from '@/assets/immersive/controls/checkmark.svg';
import locked from '@/assets/immersive/controls/checkmark-locked.svg';
import unlocked from '@/assets/immersive/controls/checkmark-unlocked.svg';
import sort from '@/assets/immersive/controls/sort-arrow.svg';
import info from '@/assets/immersive/controls/more-info.svg';
const props = defineProps<{ source: string; color: string; size: number; label: string; fallback?: string }>();
const icons: Record<string, string> = {
  checkmark,
  checkmark_locked: locked,
  checkmark_unlocked: unlocked,
  sortIcon: sort,
  icon_more_info: info,
};
const image = computed(() => props.source || (props.fallback ? icons[props.fallback] : ''));
</script>
