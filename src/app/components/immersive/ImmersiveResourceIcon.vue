<template>
  <span
    class="immersive-resource-icon"
    role="img"
    :aria-label="label"
    :style="{ width: size + 'px', height: size + 'px', backgroundColor: color, maskImage: source ? 'url(' + source + ')' : undefined }"
  />
</template>
<script setup lang="ts">
defineProps<{ source: string; color: string; size: number; label: string }>();
</script>
