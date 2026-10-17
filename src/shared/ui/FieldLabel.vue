<template>
  <div class="field-label" :class="{ 'field-label-multi': label && fieldKey }" :title="path ?? fieldKey">
    <span v-if="label" class="field-label-name">{{ label }}</span>
    <code v-if="fieldKey" class="field-label-key ui-code ui-text-muted">{{ fieldKey }}</code>
  </div>
</template>
<script setup lang="ts">
defineProps<{ label?: string; fieldKey?: string; path?: string }>();
</script>
