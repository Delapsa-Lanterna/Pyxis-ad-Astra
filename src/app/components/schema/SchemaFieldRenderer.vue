<template>
  <FieldRow
    :label="field.label"
    :field-key="field.key"
    :path="fieldPath ?? field.key"
    :layout="['object', 'array', 'array-of-object', 'key-value'].includes(field.type) ? 'group' : 'row'"
  >
    <SchemaValueInput
      :field="field"
      :value="value"
      :runtime-context="runtimeContext"
      :input-key="inputKey"
      :field-path="fieldPath"
      @update="$emit('update', $event)"
    />
    <template #hint><FieldHints :field="field" /></template>
  </FieldRow>
</template>
<script setup lang="ts">
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/app/components/schema/FieldHints.vue';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
defineProps<{ field: FieldSchema; value: unknown; runtimeContext?: SchemaRuntimeContext | null; inputKey?: string; fieldPath?: string }>();
defineEmits<{ update: [update: SchemaFieldUpdate] }>();
</script>
