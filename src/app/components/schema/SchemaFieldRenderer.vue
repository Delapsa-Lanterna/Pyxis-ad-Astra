<template>
  <SchemaFieldRow :field="field" :path="fieldPath">
    <SchemaValueInput
      :field="field"
      :value="value"
      :runtime-context="runtimeContext"
      :input-key="inputKey"
      :field-path="fieldPath"
      @update="$emit('update', $event)"
    />
  </SchemaFieldRow>
</template>
<script setup lang="ts">
import SchemaFieldRow from './SchemaFieldRow.vue';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
defineProps<{ field: FieldSchema; value: unknown; runtimeContext?: SchemaRuntimeContext | null; inputKey?: string; fieldPath?: string }>();
defineEmits<{ update: [update: SchemaFieldUpdate] }>();
</script>
