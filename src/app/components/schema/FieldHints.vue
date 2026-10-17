<template>
  <p v-if="field.description" class="field-description ui-text-description ui-text-wrap ui-text-reset">{{ field.description }}</p>
  <p v-if="field.warning" class="field-warning ui-text-note ui-text-wrap ui-text-reset">
    <strong class="ui-emphasis">注意：</strong>{{ field.warning }}
  </p>
  <p v-if="field.danger" class="field-danger ui-text-note ui-text-wrap ui-text-reset">
    <strong class="ui-emphasis">风险：</strong>{{ field.danger }}
  </p>
</template>

<script setup lang="ts">
import type { FieldSchema } from '@/domain/schema/schema.types';
defineProps<{ field: Pick<FieldSchema, 'description' | 'warning' | 'danger'> }>();
</script>
