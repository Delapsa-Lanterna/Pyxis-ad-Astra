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
    <template #default="{ row, origin: rowOrigin, update }">
      <SchemaValueInput
        :field="row.field"
        :value="row.value"
        :origin="rowOrigin"
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
    :origin="sourceOrigin"
    @update="publish($event)"
  />
  <ColorPicker
    v-else-if="mode !== 'plain' && (active.type === 'color-rgb' || active.type === 'color-rgba')"
    :model-value="value as JsonValue"
    :channels="active.type === 'color-rgb' ? 'rgb' : 'rgba'"
    :output="active.type === 'color-rgb' ? 'rgb-array' : 'rgba-array'"
    :label="active.label"
    :input-key="fieldInputKey"
    :source-origin="sourceOrigin"
    @update:model-value="publish({ kind: 'set', value: $event })"
  />
  <div v-else-if="mode !== 'plain' && active.type === 'boolean'" class="ui-control-between ui-layout-stretch">
    <n-switch
      class="tool-switch field-switch"
      :value="booleanValue === true || (typeof booleanValue === 'string' && booleanValue.toLowerCase() === 'true')"
      size="small"
      :disabled="active.editable === false"
      @update:value="publish({ kind: 'set', value: $event })"
    />
    <span v-if="sourceOrigin" class="ui-text-muted ui-text-small">{{ booleanValue }} (来自 {{ sourceOrigin }})</span>
  </div>
  <NumberValueInput
    v-else-if="
      mode !== 'plain' && ['integer', 'float'].includes(active.type) && !(active.numberFormat === 'starsector' && typeof value === 'string')
    "
    :value="inherited ? undefined : value"
    :inherited-value="inherited ? Number(value) : undefined"
    :placeholder="inherited ? String(value ?? '') : undefined"
    :source-origin="sourceOrigin"
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
    :origin="sourceOrigin"
    :runtime-context="runtimeContext"
    :value="value"
    :input-key="fieldInputKey"
    :shape="schemaCollection(active) || active.type.startsWith('color-') ? schemaJsonInputShape(active) : 'json'"
    @update="publish($event)"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { compositionPath, composeJson, setCompositionValue, editComposedJson } from '@/domain/json-composition';
import { fieldCompositionOrigin } from '@/domain/field-editor/field-editor-context';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import SchemaCollectionInput from './SchemaCollectionInput.vue';
import SchemaReferenceInput from './SchemaReferenceInput.vue';
import SchemaScalarInput from './SchemaScalarInput.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { useFieldEditMode } from '@/app/composables/field-editor/use-field-edit-mode';
import { schemaCollection, schemaFieldVariant, schemaJsonInputShape } from '@/domain/schema/schema-values';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { fieldSchemaForContext, type FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { JsonValue } from '@/shared/types';
const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  runtimeContext?: FieldEditorContext | null;
  origin?: string | null;
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
  if (update.kind === 'remove') {
    context.apply(path, undefined);
    return;
  }
  const local = context.local(),
    sources = context.sources(),
    before = composeJson(local, sources);
  const edit = editComposedJson(local, before, setCompositionValue(before, path, update.value as JsonValue), sources, context.root);
  if (edit.notice) feedback.info(edit.notice);
  if (!edit.rejected) context.apply([], edit.value);
}
const mode = useFieldEditMode();
const fieldInputKey = computed(() => props.inputKey ?? props.field.key);
const sourceOrigin = computed(() =>
  props.origin === undefined ? fieldCompositionOrigin(props.runtimeContext, props.fieldPath ?? props.field.key) : props.origin,
);
const inherited = computed(() => sourceOrigin.value !== null);
const active = computed(() =>
  fieldSchemaForContext(props.field.variants ? schemaFieldVariant(props.field, props.value) : props.field, props.runtimeContext),
);
const booleanValue = computed(() => (props.value === undefined ? active.value.default : props.value));
const scalar = computed<FieldSchema>(() =>
  schemaCollection(active.value) || active.value.type.startsWith('color-') ? { ...active.value, type: 'json' } : active.value,
);
</script>
