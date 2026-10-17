<template>
  <footer class="editor-footer ui-footer ui-layout-row ui-layout-center ui-content-surface ui-text-muted ui-content-surface-muted">
    <span class="editor-footer-label ui-label ui-text-muted ui-text-small" v-if="note">{{ note }}</span>
    <slot />
    <div v-if="$slots.actions" class="editor-footer-actions ui-control-row ui-layout-row ui-layout-center">
      <slot name="actions" />
    </div>
  </footer>
</template>

<script setup lang="ts">
defineProps<{ note?: string }>();
</script>
