<template>
  <div class="immersive-game-frame">
    <div class="immersive-game-frame-content"><slot /></div>
    <span
      v-for="edge in edges"
      :key="edge"
      :class="'immersive-game-frame-' + edge"
      :style="{ backgroundImage: images['ui_border1_' + edge] ? 'url(' + images['ui_border1_' + edge] + ')' : undefined }"
      aria-hidden="true"
    />
  </div>
</template>
<script setup lang="ts">
defineProps<{ images: Record<string, string> }>();
const edges = ['top_left', 'top_right', 'bot_left', 'bot_right', 'top', 'bot', 'left', 'right'];
</script>
