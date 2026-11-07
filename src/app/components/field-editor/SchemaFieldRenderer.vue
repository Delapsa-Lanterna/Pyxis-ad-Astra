<template>
  <SchemaFieldRow :field="active" :path="fieldPath">
    <SchemaValueInput
      :field="active"
      :value="value"
      :runtime-context="runtimeContext"
      :input-key="inputKey"
      :field-path="fieldPath"
      :class="{ 'ui-text-muted': origin }"
      :title="origin ? '来自 ' + origin : undefined"
      @update="$emit('update', $event)"
    />
    <template v-if="runtimeContext?.composition" #actions>
      <n-button v-if="typeof value === 'string'" size="tiny" @click="runtimeContext.composition.apply(path, '')">设为空值</n-button>
      <n-button
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
import { fieldSchemaForContext, type FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { computed } from 'vue';
import { compositionOrigin, compositionPath } from '@/domain/json-composition';

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
  const context = props.runtimeContext?.composition;
  const sources = context?.sources();
  return context && sources ? compositionOrigin(context.local(), sources, path.value) : null;
});
defineEmits<{ update: [update: SchemaFieldUpdate] }>();
</script>
