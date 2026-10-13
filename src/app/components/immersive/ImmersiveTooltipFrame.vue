<template>
  <div class="immersive-tooltip-frame">
    <div class="immersive-tooltip-frame-content"><slot /></div>
    <span
      v-for="edge in edges"
      :key="edge"
      :class="'immersive-tooltip-edge-' + edge"
      :style="{ backgroundImage: images['ui_border1b_' + edge] ? 'url(' + images['ui_border1b_' + edge] + ')' : undefined }"
      aria-hidden="true"
    />
  </div>
</template>
<script setup lang="ts">
defineProps<{ images: Record<string, string> }>();
const edges = ['e', 'e_bot', 'e_top', 'w', 'w_bot', 'w_top'];
</script>
