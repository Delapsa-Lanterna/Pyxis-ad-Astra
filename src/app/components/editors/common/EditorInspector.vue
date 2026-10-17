<template>
  <aside class="editor-side ui-content-contained ui-content-surface-muted">
    <div class="inspector-title ui-text-muted">{{ title }}</div>
    <div class="editor-scroll ui-content-scroll">
      <slot />
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{ title: string }>();
</script>
