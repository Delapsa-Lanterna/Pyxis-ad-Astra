<template>
  <div class="immersive-section-heading ui-layout-grid ui-layout-center ui-content-surface-muted">
    <h2
      class="immersive-group-title immersive-section-heading-title ui-text-small ui-text-reset ui-control-reset ui-content-surface-muted ui-layout-shrink"
    >
      <ImmersiveText :text="title" font="heading" />
    </h2>
    <div v-if="$slots.default" class="immersive-section-action"><slot /></div>
  </div>
</template>
<script setup lang="ts">
import ImmersiveText from './ImmersiveText.vue';
defineProps<{ title: string }>();
</script>
