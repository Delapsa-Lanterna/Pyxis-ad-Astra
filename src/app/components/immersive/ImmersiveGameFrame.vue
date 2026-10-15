<template>
  <div class="immersive-game-frame" :class="{ textured }">
    <div class="immersive-game-frame-content"><slot /></div>
    <div v-if="textured" class="immersive-game-border" aria-hidden="true">
      <span
        v-for="(edge, index) in edges"
        :key="edge"
        :style="{ gridArea: areas[index], backgroundImage: 'url(' + images['ui_border1_' + edge] + ')' }"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{ images?: Record<string, string> }>(), { images: () => ({}) });
const edges = ['top_left', 'top', 'top_right', 'left', 'right', 'bot_left', 'bot', 'bot_right'];
const areas = ['1 / 1', '1 / 2', '1 / 3', '2 / 1', '2 / 3', '3 / 1', '3 / 2', '3 / 3'];
const textured = computed(() => edges.every((edge) => props.images['ui_border1_' + edge]));
</script>
