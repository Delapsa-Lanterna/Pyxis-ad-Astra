<template>
  <SchemaCollectionInput
    v-if="schemaCollection(active) && (mode !== 'plain' || active.presentation === 'groups')"
    :field="active"
    :value="value"
    :input-key="fieldInputKey"
    :field-path="fieldPath ?? field.key"
    @update="emit('update', $event)"
  >
    <template #default="{ row, update }">
      <SchemaValueInput
        :field="row.field"
        :value="row.value"
        :input-key="row.inputKey"
        :field-path="row.path"
        :runtime-context="runtimeContext"
        @update="update"
      />
    </template>
  </SchemaCollectionInput>
  <SchemaReferenceInput
    v-else-if="['enum', 'path', 'path-image', 'string-array', 'tag-select'].includes(active.type)"
    :field="active"
    :value="value"
    :input-key="fieldInputKey"
    :runtime-context="runtimeContext"
    @update="emit('update', $event)"
  />
  <ColorPicker
    v-else-if="mode !== 'plain' && (active.type === 'color-rgb' || active.type === 'color-rgba')"
    :model-value="value as JsonValue"
    :channels="active.type === 'color-rgb' ? 'rgb' : 'rgba'"
    :output="active.type === 'color-rgb' ? 'rgb-array' : 'rgba-array'"
    :label="active.label"
    :input-key="fieldInputKey"
    @update:model-value="emit('update', { kind: 'set', value: $event })"
  />
  <n-switch
    v-else-if="mode !== 'plain' && active.type === 'boolean'"
    class="tool-switch field-switch"
    :value="booleanValue === true || (typeof booleanValue === 'string' && booleanValue.toLowerCase() === 'true')"
    size="small"
    :disabled="active.editable === false"
    @update:value="emit('update', { kind: 'set', value: $event })"
  />
  <SchemaScalarInput
    v-else
    :field="scalar"
    :value="value"
    :input-key="fieldInputKey"
    :shape="schemaCollection(active) || active.type.startsWith('color-') ? schemaJsonInputShape(active) : 'json'"
    @update="emit('update', $event)"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import SchemaCollectionInput from './SchemaCollectionInput.vue';
import SchemaReferenceInput from './SchemaReferenceInput.vue';
import SchemaScalarInput from './SchemaScalarInput.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { schemaCollection, schemaFieldVariant, schemaJsonInputShape } from '@/domain/schema/schema-values';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { JsonValue } from '@/shared/types';
const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  runtimeContext?: SchemaRuntimeContext | null;
  inputKey?: string;
  fieldPath?: string;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const mode = useInputEditMode();
const fieldInputKey = computed(() => props.inputKey ?? props.field.key);
const active = computed(() => (props.field.variants ? schemaFieldVariant(props.field, props.value) : props.field));
const booleanValue = computed(() => (props.value === undefined ? active.value.default : props.value));
const scalar = computed<FieldSchema>(() =>
  schemaCollection(active.value) || active.value.type.startsWith('color-') ? { ...active.value, type: 'json' } : active.value,
);
</script>
