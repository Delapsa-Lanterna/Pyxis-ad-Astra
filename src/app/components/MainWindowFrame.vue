<template>
  <div
    class="app-frame app-frame-main ui-content-contained ui-text-normal ui-layout-grid"
    :class="{ 'app-shell-nav-hidden': !navigationVisible || !navigationExpanded, 'app-shell-narrow': narrow }"
  >
    <slot name="titlebar" />
    <slot name="tabs" />
    <div class="app-shell ui-content-contained ui-layout-grid">
      <slot name="navigation" />
      <main class="page-slot ui-content-column ui-content-contained">
        <slot name="notice" />
        <slot />
      </main>
    </div>
  </div>
</template>
<script setup lang="ts">
defineProps<{ navigationVisible: boolean; narrow: boolean; navigationExpanded: boolean }>();
</script>
