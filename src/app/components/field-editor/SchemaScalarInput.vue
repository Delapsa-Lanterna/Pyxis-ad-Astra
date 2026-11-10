<template>
  <n-input
    ref="input"
    class="ui-field-autosize"
    :class="{ 'ui-field-number': numeric, 'field-json-input': field.type === 'json' }"
    :value="raw"
    :placeholder="inherited ? display() : undefined"
    :disabled="field.editable === false"
    :type="multiline ? 'textarea' : 'text'"
    :autosize="multiline ? { minRows: 1, maxRows: 10 } : undefined"
    :status="invalid ? 'error' : undefined"
    size="small"
    @update:value="update"
    @blur="commit"
    @change="commit"
    @keydown="keydown"
  >
    <template v-if="sourceOrigin" #suffix
      ><span class="ui-text-muted ui-text-small">(来自 {{ sourceOrigin }})</span></template
    >
  </n-input>
</template>
<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { AppError } from '@/shared/lib/errors';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { JsonInputShape } from '@/shared/types';
import { fieldCompositionOrigin, fieldDocumentPath, fieldOriginalText } from '@/domain/field-editor/field-editor-context';
import { prepareSchemaValue } from '@/domain/schema/game-number';
import {
  convertSchemaScalarInput,
  formatSchemaCommaList,
  parseSchemaCommaList,
  schemaArrayStringValues,
  schemaStringValue,
  schemaTagValues,
  wrapSchemaTagValues,
} from '@/domain/schema/schema-values';
import { formatJsonInput, parseJsonInput } from '@/shared/lib/json-input';
import { useRawFieldInput } from '@/shared/runtime/raw-field-input';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  inputKey: string;
  fieldPath?: string;
  runtimeContext?: FieldEditorContext | null;
  initialText?: string;
  shape?: JsonInputShape;
  validate?: (value: unknown) => string | null;
  origin?: string | null;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate]; cancel: [] }>();
const input = ref<{ inputElRef: HTMLInputElement | null; textareaElRef: HTMLTextAreaElement | null; focus: () => void } | null>(null);
const numeric = computed(() => props.field.type === 'integer' || props.field.type === 'float');
const multiline = computed(() => props.field.type === 'text' || props.field.type === 'json');
const sourceOrigin = computed(() =>
  props.origin === undefined ? fieldCompositionOrigin(props.runtimeContext, props.fieldPath ?? props.field.key) : props.origin,
);
const inherited = computed(() => sourceOrigin.value !== null);
function display(): string {
  if (props.field.type === 'json') return formatJsonInput(props.value, props.shape ?? 'json');
  if (props.field.type === 'tag-select') return formatSchemaCommaList(schemaTagValues(props.value));
  if (props.field.type === 'string-array') return formatSchemaCommaList(schemaArrayStringValues(props.value));
  if (numeric.value && typeof props.value === 'number')
    return fieldOriginalText(props.runtimeContext, props.fieldPath ?? props.field.key) ?? String(props.value);
  return schemaStringValue(props.value);
}
const { raw, invalid, update, commit, cancel } = useRawFieldInput<unknown>({
  key: props.inputKey,
  path: props.fieldPath ?? props.field.key,
  label: props.field.label,
  text: () => (inherited.value ? '' : display()),
  convert: (text) => {
    if (props.field.type === 'json') return parseJsonInput(text, props.shape ?? 'json');
    if (props.field.type === 'string-array' || props.field.type === 'tag-select')
      return {
        kind: 'value',
        value:
          props.field.type === 'tag-select' ? wrapSchemaTagValues(props.value, parseSchemaCommaList(text)) : parseSchemaCommaList(text),
      };
    const result = convertSchemaScalarInput(text, props.field);
    if (result.kind !== 'set') return result;
    const message = props.validate?.(result.value);
    return message ? { kind: 'error', message } : { kind: 'value', value: result.value };
  },
  apply: (result) => {
    const update: SchemaFieldUpdate = result.kind === 'remove' ? result : { kind: 'set', value: result.value };
    if (result.kind === 'value' && props.runtimeContext?.document) {
      const path = fieldDocumentPath(props.runtimeContext, props.fieldPath ?? props.field.key);
      if (path && props.runtimeContext.document.find(path))
        update.fileEdit = { kind: 'replace', path, value: prepareSchemaValue(result.value, props.field) };
    }
    emit('update', update);
  },
  onCancel: () => emit('cancel'),
  focus: async () => {
    await focusFieldInput((multiline.value ? input.value?.textareaElRef : input.value?.inputElRef) ?? null);
    input.value?.focus();
  },
});
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancel();
    event.preventDefault();
  } else if (event.key === 'Enter' && (!multiline.value || event.ctrlKey)) {
    commit();
    event.preventDefault();
  }
}
if (props.initialText !== undefined) update(props.initialText);
onMounted(() => {
  if (props.initialText !== undefined) input.value?.focus();
});
const inputs = useFieldInputs();
if (inputs)
  onScopeDispose(
    inputs.registerFinalizer(async (validate) => {
      if (
        validate &&
        !inputs.hasCompleteDocumentValidation.value &&
        props.field.required &&
        !props.runtimeContext?.partial &&
        raw.value.trim() === ''
      ) {
        await focusFieldInput((multiline.value ? input.value?.textareaElRef : input.value?.inputElRef) ?? null);
        input.value?.focus();
        throw new AppError(`${props.field.label}：必填字段不能为空`, { action: 'commit-field-inputs' });
      }
    }, props.inputKey),
  );
defineExpose({ commit, cancel, focus: () => input.value?.focus() });
</script>
