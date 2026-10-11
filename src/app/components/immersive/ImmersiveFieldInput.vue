<template>
  <label class="immersive-field-input">
    <span>{{ field.schema.label }}</span>
    <n-select
      v-if="mode === 'smart' && (field.schema.options || field.schema.source)"
      ref="input"
      :value="raw"
      :options="selectOptions"
      :status="invalid ? 'error' : undefined"
      clearable
      @update:value="update($event ?? '')"
    />
    <n-input
      v-else
      ref="input"
      :value="raw"
      :type="field.schema.type === 'text' ? 'textarea' : 'text'"
      :autosize="field.schema.type === 'text' ? { minRows: 2, maxRows: 8 } : undefined"
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
import { includeCurrentSelectOptions } from '@/domain/schema/schema-options';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
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
watch(input, (control) => {
  if (props.active && props.autofocus) control?.focus();
});
const { raw, invalid, update } = useRawFieldInput<unknown>({
  key: props.inputKey,
  label: props.field.schema.label,
  text: () => schemaStringValue(props.value),
  forceCommit: () => props.active && props.value === undefined,
  convert: (text) => {
    const schema = props.field.schema;
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
const selectOptions = computed(() =>
  props.field.schema.source
    ? includeCurrentSelectOptions(source.sourceOptions.value, [raw.value])
    : props.field.schema.options?.map((value) => ({ label: value, value })),
);
</script>
