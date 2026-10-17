<template>
  <div class="immersive-tooltip-frame" :class="{ textured }">
    <div class="immersive-tooltip-frame-content"><slot /></div>
    <span
      class="immersive-tooltip-frame-label"
      v-for="edge in textured ? edges : []"
      :key="edge"
      :class="'immersive-tooltip-edge-' + edge"
      :style="{ backgroundImage: 'url(' + images['ui_border1b_' + edge] + ')' }"
      aria-hidden="true"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ images: Record<string, string> }>();
const edges = ['e', 'e_bot', 'e_top', 'w', 'w_bot', 'w_top'];
const textured = computed(() => edges.every((edge) => props.images['ui_border1b_' + edge]));
</script>
