<template>
  <n-input
    ref="input"
    :value="raw"
    :class="{ 'ui-field-number': field.type === 'integer' || field.type === 'float', 'field-json-input': field.type === 'json' }"
    :disabled="field.editable === false"
    :type="multiline ? 'textarea' : 'text'"
    :autosize="multiline ? { minRows: 1, maxRows: 10 } : undefined"
    :status="invalid ? 'error' : undefined"
    size="small"
    @update:value="update"
    @change="commit"
    @blur="commit"
    @keydown="onKeydown"
  />
</template>

<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import {
  convertSchemaScalarInput,
  schemaPlainBooleanText,
  schemaArrayStringValues,
  schemaTagValues,
  formatSchemaCommaList,
  parseSchemaCommaList,
  wrapSchemaTagValues,
} from '@/domain/schema/schema-values';
import { useRawFieldInput } from '@/shared/runtime/raw-field-input';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { AppError } from '@/shared/lib/errors';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import { cell } from '@/shared/lib/starsector';
import { formatJsonInput, parseJsonInput } from '@/shared/lib/json-input';
import type { JsonInputShape } from '@/shared/types';

const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  inputKey: string;
  fieldPath?: string;
  initialText?: string;
  shape?: JsonInputShape;
  validate?: (value: unknown) => string | null;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate]; cancel: [] }>();
const multiline = props.field.type === 'text' || props.field.type === 'json';
const input = ref<{ inputElRef: HTMLInputElement | null; textareaElRef: HTMLTextAreaElement | null; focus: () => void } | null>(null);
const { raw, invalid, update, commit, cancel } = useRawFieldInput<unknown>({
  key: props.inputKey,
  path: props.fieldPath ?? props.field.key,
  label: props.field.label,
  text: () =>
    props.field.type === 'json'
      ? formatJsonInput(props.value, props.shape ?? 'json')
      : props.field.type === 'string-array'
        ? formatSchemaCommaList(schemaArrayStringValues(props.value))
        : props.field.type === 'tag-select'
          ? formatSchemaCommaList(schemaTagValues(props.value))
          : props.field.type === 'boolean'
            ? schemaPlainBooleanText(props.value)
            : cell(props.value),
  convert: (text) => {
    if (props.field.type === 'json') return parseJsonInput(text, props.shape ?? 'json');
    if (props.field.type === 'string-array' || props.field.type === 'tag-select')
      return {
        kind: 'value',
        value:
          props.field.type === 'tag-select' ? wrapSchemaTagValues(props.value, parseSchemaCommaList(text)) : parseSchemaCommaList(text),
      };
    const converted = convertSchemaScalarInput(text, props.field);
    if (converted.kind === 'set') {
      const message = props.validate?.(converted.value);
      if (message) return { kind: 'error', message };
    }
    return converted.kind === 'set' ? { kind: 'value', value: converted.value } : converted;
  },
  apply: (converted) => emit('update', converted.kind === 'value' ? { kind: 'set', value: converted.value } : converted),
  onCancel: () => emit('cancel'),
  focus: async () => {
    await focusFieldInput((multiline ? input.value?.textareaElRef : input.value?.inputElRef) ?? null);
    input.value?.focus();
  },
});
if (props.initialText !== undefined) update(props.initialText);
onMounted(() => {
  if (props.initialText !== undefined) input.value?.focus();
});
defineExpose({ commit });
const inputs = useFieldInputs();
if (inputs && (props.field.required || props.field.requiredWhen))
  onScopeDispose(
    inputs.registerFinalizer(async () => {
      if (inputs.hasDocumentValidation.value) return;
      if (props.field.required && raw.value.trim() === '') {
        await focusFieldInput((multiline ? input.value?.textareaElRef : input.value?.inputElRef) ?? null);
        input.value?.focus();
        throw new AppError(`${props.field.label}：必填字段不能为空`, { action: 'commit-field-inputs' });
      }
    }, props.inputKey),
  );
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== 'Escape') return;
  if (event.isComposing || (event.key === 'Enter' && multiline && !event.ctrlKey)) return;
  event.preventDefault();
  if (event.key === 'Escape') {
    event.stopPropagation();
    cancel();
  } else commit();
}
</script>
