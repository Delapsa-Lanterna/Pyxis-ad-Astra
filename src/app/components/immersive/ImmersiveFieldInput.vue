<template>
  <label class="immersive-field-input ui-layout-grid ui-layout-shrink">
    <span><ImmersiveText :text="field.schema.label" /></span>
    <n-select
      :virtual-scroll="false"
      :disabled="disabled"
      v-if="mode === 'smart' && (field.schema.options || field.schema.source)"
      ref="input"
      :value="raw"
      :options="selectOptions"
      :status="invalid ? 'error' : undefined"
      :clearable="!field.schema.required"
      :filterable="Boolean(field.schema.source)"
      :tag="isConfigFieldSource(field.schema.source)"
      @update:value="update($event ?? '')"
    />
    <n-input
      class="ui-field-autosize immersive-field-autosize"
      :disabled="disabled"
      :placeholder="inheritedValue !== undefined ? schemaStringValue(inheritedValue) : field.inheritOnEmpty ? '空白继承' : undefined"
      v-else
      ref="input"
      :value="raw"
      :type="field.schema.type === 'text' || jsonShape ? 'textarea' : 'text'"
      :autosize="field.schema.type === 'text' || jsonShape ? { minRows: 2, maxRows: 8 } : undefined"
      :status="invalid ? 'error' : undefined"
      @update:value="update"
    />
  </label>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ImmersiveField } from '@/domain/immersive/fields';
import { convertSchemaScalarInput, schemaStringValue } from '@/domain/schema/schema-values';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import { useFieldSourceOptions } from '@/app/composables/field-editor/use-field-source-options';
import { useRawFieldInput } from '@/shared/runtime/raw-field-input';
import { includeCurrentSelectOptions, selectOptionValues } from '@/domain/field-editor/field-options';
import { useFieldEditMode } from '@/app/composables/field-editor/use-field-edit-mode';
import { isConfigFieldSource } from '@/domain/schema/schema-source-definitions';
import { parseJsonInput, formatJsonInput } from '@/shared/lib/json-input';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{
  field: ImmersiveField;
  value: unknown;
  inheritedValue?: unknown;
  inputKey: string;
  runtimeContext: FieldEditorContext;
  active: boolean;
  autofocus: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const input = ref<{ focus: () => void } | null>(null);
const mode = useFieldEditMode();
const jsonShape = computed(() => (props.field.schema.type === 'array' ? 'array' : props.field.schema.type === 'object' ? 'object' : null));
watch(input, (control) => {
  if (props.active && props.autofocus && !props.disabled) control?.focus();
});
const { raw, invalid, update } = useRawFieldInput<unknown>({
  key: props.inputKey,
  label: props.field.schema.label,
  text: () => (jsonShape.value ? formatJsonInput(props.value, jsonShape.value) : schemaStringValue(props.value)),
  convert: (text) => {
    if ((props.field.inheritOnEmpty || props.inheritedValue !== undefined) && !text.trim()) return { kind: 'remove' };
    const schema = props.field.schema;
    if (jsonShape.value) return parseJsonInput(text, jsonShape.value);
    if (schema.type === 'integer' || schema.type === 'float' || schema.type === 'boolean') {
      const converted = convertSchemaScalarInput(text, schema);
      return converted.kind === 'set' ? { kind: 'value', value: converted.value } : converted;
    }
    if (schema.required && !text.trim()) return { kind: 'error', message: '必填字段不能为空' };
    return { kind: 'value', value: text };
  },
  apply: (converted) => emit('update', converted.kind === 'value' ? { kind: 'set', value: converted.value } : converted),
  focus: () => input.value?.focus(),
});
const source = useFieldSourceOptions({
  field: () => props.field.schema,
  value: () => raw.value,
  runtimeContext: () => props.runtimeContext,
});
const sourceValues = computed(() => selectOptionValues(source.sourceOptions.value));
const selectOptions = computed(() =>
  props.field.schema.source
    ? includeCurrentSelectOptions(source.sourceOptions.value, [raw.value], sourceValues.value)
    : props.field.schema.options?.map((value) => ({ label: props.field.optionLabels?.[value] ?? value, value })),
);
</script>
