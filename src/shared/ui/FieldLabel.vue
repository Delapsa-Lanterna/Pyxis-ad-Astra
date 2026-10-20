<template>
  <div class="field-label" :class="{ 'field-label-multi': label && fieldKey }" :title="title">
    <span v-if="label" class="field-label-name"
      >{{ label }}<sup v-if="required" class="field-label-required" aria-hidden="true">*</sup></span
    >
    <code v-if="fieldKey" class="field-label-key ui-code ui-text-muted">{{ fieldKey }}</code>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ label?: string; fieldKey?: string; path?: string; description?: string; required?: boolean }>();
const title = computed(() => [props.path ?? props.fieldKey, props.description].filter(Boolean).join('\n') || undefined);
</script>
