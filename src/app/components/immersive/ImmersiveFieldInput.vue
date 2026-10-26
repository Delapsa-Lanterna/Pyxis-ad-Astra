<template>
  <label class="immersive-field-input ui-layout-grid ui-layout-shrink">
    <span><ImmersiveText :text="field.schema.label" /></span>
    <n-select
      :virtual-scroll="false"
      v-if="mode === 'smart' && (field.schema.options || field.schema.source)"
      ref="input"
      :value="raw"
      :options="selectOptions"
      :status="invalid ? 'error' : undefined"
      :clearable="!field.schema.required"
      :filterable="Boolean(field.schema.source)"
      :tag="isConfigSource(field.schema.source)"
      @update:value="update($event ?? '')"
    />
    <n-input
      class="ui-field-autosize immersive-field-autosize"
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
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { useSchemaSourceOptions } from '@/app/composables/editors/use-schema-source-options';
import { useRawFieldInput } from '@/shared/runtime/raw-field-input';
import { includeCurrentSelectOptions, selectOptionValues } from '@/domain/schema/schema-options';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { isConfigSource } from '@/domain/schema/schema-sources';
import { parseJsonInput, formatJsonInput } from '@/shared/lib/json-input';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{
  field: ImmersiveField;
  value: unknown;
  inputKey: string;
  runtimeContext: SchemaRuntimeContext;
  active: boolean;
  autofocus: boolean;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const input = ref<{ focus: () => void } | null>(null);
const mode = useInputEditMode();
const jsonShape = computed(() => (props.field.schema.type === 'array' ? 'array' : props.field.schema.type === 'object' ? 'object' : null));
watch(input, (control) => {
  if (props.active && props.autofocus) control?.focus();
});
const { raw, invalid, update } = useRawFieldInput<unknown>({
  key: props.inputKey,
  label: props.field.schema.label,
  text: () => (jsonShape.value ? formatJsonInput(props.value, jsonShape.value) : schemaStringValue(props.value)),
  forceCommit: () => props.active && props.value === undefined,
  convert: (text) => {
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
const source = useSchemaSourceOptions({
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
