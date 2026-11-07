<template>
  <SchemaFieldRow :field="active" :path="fieldPath">
    <SchemaValueInput
      :field="active"
      :value="value"
      :runtime-context="runtimeContext"
      :origin="origin"
      :input-key="inputKey"
      :field-path="fieldPath"
      @update="$emit('update', $event)"
    />
    <template v-if="runtimeContext?.composition" #actions>
      <n-button
        v-if="canRestoreReference"
        class="compact-icon-button ui-control-reset"
        size="tiny"
        quaternary
        title="使用引用值"
        aria-label="使用引用值"
        @click="runtimeContext.composition.apply(path, undefined)"
      >
        <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10a9 9 0 1 1 2.3 8M3 4v6h6" />
        </svg>
      </n-button>
    </template>
  </SchemaFieldRow>
</template>
<script setup lang="ts">
import SchemaFieldRow from './SchemaFieldRow.vue';
import SchemaValueInput from '@/app/components/field-editor/SchemaValueInput.vue';
import { fieldCompositionOrigin, fieldSchemaForContext, type FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { computed } from 'vue';
import { compositionPath, hasRestorableCompositionValue } from '@/domain/json-composition';

const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  runtimeContext?: FieldEditorContext | null;
  inputKey?: string;
  fieldPath?: string;
}>();
const active = computed(() => fieldSchemaForContext(props.field, props.runtimeContext));
const path = computed(() => compositionPath(props.fieldPath ?? props.field.key));
const origin = computed(() => {
  return fieldCompositionOrigin(props.runtimeContext, props.fieldPath ?? props.field.key);
});
const canRestoreReference = computed(() => {
  const context = props.runtimeContext?.composition;
  const sources = context?.sources();
  return context && sources ? hasRestorableCompositionValue(context.local(), sources, path.value) : false;
});
defineEmits<{ update: [update: SchemaFieldUpdate] }>();
</script>
