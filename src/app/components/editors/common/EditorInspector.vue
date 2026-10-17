<template>
  <aside class="editor-side editor-inspector ui-content-contained ui-content-column ui-content-surface-muted">
    <div class="editor-inspector-heading ui-control-between ui-text-soft ui-content-surface-muted">
      <span>{{ title }}</span
      ><small class="editor-inspector-heading-meta ui-text-muted">属性编辑</small>
    </div>
    <div class="editor-scroll editor-fields ui-content-scroll"><slot /></div>
  </aside>
</template>
<script setup lang="ts">
defineProps<{ title: string }>();
</script>
