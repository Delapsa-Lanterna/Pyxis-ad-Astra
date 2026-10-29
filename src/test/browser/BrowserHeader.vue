<template>
  <header class="workbench-header">
    <div class="workbench-identity">
      <svg class="ui-control-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </svg>
      <strong>星界罗盘</strong><span>/</span><span>{{ title }}</span>
      <output aria-live="polite"><slot name="status" /></output>
    </div>
    <div class="workbench-actions"><slot /></div>
  </header>
</template>
<script setup lang="ts">
import './browser.css';
defineProps<{ title: string }>();
</script>
