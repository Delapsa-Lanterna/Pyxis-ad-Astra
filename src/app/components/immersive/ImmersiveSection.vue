<template>
  <div class="immersive-section-heading">
    <h2 class="immersive-group-title"><ImmersiveText :text="title" font="heading" /></h2>
    <div v-if="$slots.default" class="immersive-section-action"><slot /></div>
  </div>
</template>
<script setup lang="ts">
import ImmersiveText from './ImmersiveText.vue';
defineProps<{ title: string }>();
</script>
