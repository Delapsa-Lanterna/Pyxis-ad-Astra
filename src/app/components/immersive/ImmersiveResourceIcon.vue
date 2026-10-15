<template>
  <span
    class="immersive-resource-icon"
    role="img"
    :aria-label="label"
    :style="{
      width: size + 'px',
      height: size + 'px',
      color,
      backgroundColor: source ? color : undefined,
      maskImage: source ? 'url(' + source + ')' : undefined,
    }"
  >
    <svg
      v-if="!source && fallback"
      width="100%"
      height="100%"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path :d="paths[fallback]" />
    </svg>
  </span>
</template>
<script setup lang="ts">
defineProps<{ source: string; color: string; size: number; label: string; fallback?: string }>();
const paths: Record<string, string> = {
  checkmark: 'M3 10l4 4L17 4',
  checkmark_locked: 'M6 9V6a4 4 0 018 0v3M4 9h12v8H4zM10 12v2',
  checkmark_unlocked: 'M7 9V6a4 4 0 018 0M4 9h12v8H4zM10 12v2',
  sortIcon: 'M4 7l6 6 6-6',
};
</script>
