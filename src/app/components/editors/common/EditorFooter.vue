<template>
  <footer class="editor-footer ui-footer ui-control-between ui-content-surface">
    <span v-if="note" class="editor-footer-note ui-text-path ui-text-muted">{{ note }}</span
    ><slot />
    <div v-if="$slots.actions" class="editor-actions action-group"><slot name="actions" /></div>
  </footer>
</template>
<script setup lang="ts">
defineProps<{ note?: string }>();
</script>
