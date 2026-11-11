<template>
  <n-button
    size="tiny"
    quaternary
    :title="title ?? label"
    :aria-label="label"
    :aria-pressed="pressed"
    :type="pressed ? 'primary' : 'default'"
    :disabled="disabled"
  >
    <svg class="code-tool-icon ui-control-icon" viewBox="0 0 16 16" stroke-width="1.5" aria-hidden="true"><path :d="path" /></svg>
  </n-button>
</template>
<script setup lang="ts">
defineProps<{ label: string; path: string; title?: string; pressed?: boolean; disabled?: boolean }>();
</script>
