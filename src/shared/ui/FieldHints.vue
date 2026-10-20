<template>
  <p v-if="description" class="field-description ui-text-description ui-text-wrap ui-text-reset">
    {{ description }}
  </p>
  <p v-if="warning" class="field-warning ui-text-note ui-text-wrap ui-text-reset">
    <strong class="ui-emphasis">注意：</strong>{{ warning }}
  </p>
  <p v-if="danger" class="field-danger ui-text-note ui-text-wrap ui-text-reset"><strong class="ui-emphasis">风险：</strong>{{ danger }}</p>
</template>

<script setup lang="ts">
defineProps<{ description?: string; warning?: string; danger?: string }>();
</script>
