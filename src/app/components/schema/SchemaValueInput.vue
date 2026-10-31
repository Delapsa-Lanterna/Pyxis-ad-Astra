<template>
  <SchemaCollectionInput
    v-if="schemaCollection(active) && (mode !== 'plain' || active.presentation === 'groups')"
    :field="active"
    :value="value"
    :input-key="fieldInputKey"
    :field-path="fieldPath ?? field.key"
    :runtime-context="runtimeContext"
    @update="publish($event)"
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
    :field-path="fieldPath"
    :runtime-context="runtimeContext"
    @update="publish($event)"
  />
  <ColorPicker
    v-else-if="mode !== 'plain' && (active.type === 'color-rgb' || active.type === 'color-rgba')"
    :model-value="value as JsonValue"
    :channels="active.type === 'color-rgb' ? 'rgb' : 'rgba'"
    :output="active.type === 'color-rgb' ? 'rgb-array' : 'rgba-array'"
    :label="active.label"
    :input-key="fieldInputKey"
    @update:model-value="publish({ kind: 'set', value: $event })"
  />
  <n-switch
    v-else-if="mode !== 'plain' && active.type === 'boolean'"
    class="tool-switch field-switch"
    :theme-overrides="inherited ? { railColorActive: 'var(--color-muted)' } : undefined"
    :value="booleanValue === true || (typeof booleanValue === 'string' && booleanValue.toLowerCase() === 'true')"
    size="small"
    :disabled="active.editable === false"
    @update:value="publish({ kind: 'set', value: $event })"
  />
  <NumberValueInput
    v-else-if="
      mode !== 'plain' && ['integer', 'float'].includes(active.type) && !(active.numberFormat === 'starsector' && typeof value === 'string')
    "
    :value="inherited ? undefined : value"
    :inherited-value="inherited ? Number(value) : undefined"
    :placeholder="inherited ? String(value ?? '') : undefined"
    :input-key="fieldInputKey"
    :label="active.label"
    :integer="active.type === 'integer'"
    :clear-action="runtimeContext?.composition ? 'remove' : active.required ? 'required' : 'remove'"
    :min="active.min"
    :max="active.max"
    :step="active.step ?? 1"
    :disabled="active.editable === false"
    size="small"
    @update:value="publish({ kind: 'set', value: $event })"
    @remove="publish({ kind: 'remove' })"
  />
  <SchemaScalarInput
    v-else
    :field-path="fieldPath"
    :field="scalar"
    :runtime-context="runtimeContext"
    :value="value"
    :input-key="fieldInputKey"
    :shape="schemaCollection(active) || active.type.startsWith('color-') ? schemaJsonInputShape(active) : 'json'"
    @update="publish($event)"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import {
  compositionValue,
  compositionPath,
  composeJson,
  setCompositionValue,
  editComposedJson,
  compositionOrigin,
} from '@/domain/schema/json-composition';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import SchemaCollectionInput from './SchemaCollectionInput.vue';
import SchemaReferenceInput from './SchemaReferenceInput.vue';
import SchemaScalarInput from './SchemaScalarInput.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
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
const feedback = useAppFeedback();
function publish(update: SchemaFieldUpdate) {
  const context = props.runtimeContext?.composition;
  if (!context) {
    emit('update', update);
    return;
  }
  const path = compositionPath(props.fieldPath ?? props.field.key);
  if (update.kind === 'remove' || update.value === '') {
    context.apply(path, undefined);
    return;
  }
  const local = context.local(),
    before = composeJson(local, context.sources());
  const next = editComposedJson(local, before, setCompositionValue(before, path, update.value as JsonValue));
  const apply = () => context.apply([], next);
  const own = compositionValue(local, path);
  if (
    Array.isArray(update.value) &&
    Array.isArray(props.value) &&
    props.value.length &&
    (!Array.isArray(own) || own[0] !== 'core_clearArray') &&
    (compositionValue(next, path) as JsonValue[])[0] === 'core_clearArray'
  )
    feedback.confirmWarning({
      title: '替换整个列表？',
      content: '当前修改需要清空基础列表并保存完整本地列表。',
      actionText: '替换整个列表',
      onConfirm: apply,
    });
  else apply();
}
const mode = useInputEditMode();
const fieldInputKey = computed(() => props.inputKey ?? props.field.key);
const inherited = computed(() => {
  const context = props.runtimeContext?.composition,
    sources = context?.sources();
  return context && sources && compositionOrigin(context.local(), sources, compositionPath(props.fieldPath ?? props.field.key)) !== null;
});
const active = computed(() => (props.field.variants ? schemaFieldVariant(props.field, props.value) : props.field));
const booleanValue = computed(() => (props.value === undefined ? active.value.default : props.value));
const scalar = computed<FieldSchema>(() =>
  schemaCollection(active.value) || active.value.type.startsWith('color-') ? { ...active.value, type: 'json' } : active.value,
);
</script>
