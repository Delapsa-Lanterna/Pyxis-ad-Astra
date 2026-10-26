<template>
  <div v-if="fields.length" class="ui-field-stack">
    <FieldRow
      v-for="field in fields"
      :key="field.key"
      :label="field.label"
      :field-key="field.key"
      :path="path(field)"
      :required="field.required"
      :layout="schemaCollection(field) ? 'group' : 'row'"
    >
      <n-select
        v-if="field.key === 'textureType' && field.options"
        :value="Array.isArray(value(field)) ? '自定义' : value(field)"
        :options="toOptions([...field.options, '自定义'])"
        filterable
        @update:value="$emit('update', path(field), $event === '自定义' ? ['', ''] : $event)"
      />
      <slot v-else :name="field.key" :value="value(field)" :path="path(field)">
        <SchemaValueInput
          :field="{ ...field, key: path(field), editable: readonlyFields.includes(field.key) ? false : field.editable }"
          :value="value(field)"
          :input-key="path(field)"
          :field-path="path(field)"
          :runtime-context="fieldRuntime"
          @update="updateField(field, $event)"
        />
      </slot>
      <template #hint
        ><span v-if="stored(field) === undefined && field.required" class="ui-text-muted ui-text-small">未设置</span></template
      >
    </FieldRow>
    <template
      v-for="field in fields.filter((item) => item.key === 'textureType' && Array.isArray(stored(item)))"
      :key="path(field) + '-textures'"
    >
      <FieldRow
        v-for="index in [0, 1]"
        :key="index"
        :label="index === 0 ? '外围纹理' : '核心纹理'"
        :field-key="path(field) + '[' + index + ']'"
      >
        <SchemaValueInput
          :field="{ ...field.variants![1]!.item!, key: path(field) + '[' + index + ']' }"
          :value="(stored(field) as string[])[index]"
          :input-key="path(field) + '[' + index + ']'"
          :runtime-context="fieldRuntime"
          @update="$event.kind === 'set' && $emit('update', path(field) + '[' + index + ']', $event.value as JsonValue)"
        />
      </FieldRow>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, inject } from 'vue';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import { specSchemaContext } from '@/app/composables/spec-editor/spec-schema-context';
import FieldRow from '@/shared/ui/FieldRow.vue';
import { toOptions } from '@/domain/editors/lib/editor-constants';
import { schemaCollection, schemaFieldRequired } from '@/domain/schema/schema-values';
import { specFieldParent, type SpecField } from '@/domain/editors/spec-construction';
import type { JsonValue, RowData } from '@/shared/types';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
const props = withDefaults(defineProps<{ content: RowData; fields: SpecField[]; prefix?: string; readonlyFields?: string[] }>(), {
  prefix: '',
  readonlyFields: () => [],
});
const schemaRuntime = inject(specSchemaContext, null);
const fieldRuntime = computed(() => (schemaRuntime?.value ? { ...schemaRuntime.value, readValue: () => props.content } : null));
const fields = computed(() =>
  props.fields.map((field) =>
    field.requiredWhen
      ? {
          ...field,
          required: schemaFieldRequired(field, (key) => stored({ key }) ?? props.fields.find((item) => item.key === key)?.default),
        }
      : field,
  ),
);
const emit = defineEmits<{ update: [path: string, value: JsonValue]; remove: [path: string]; change: [path: string] }>();
function updateField(field: SpecField, update: SchemaFieldUpdate) {
  if (update.kind === 'set') emit('update', path(field), update.value as JsonValue);
  else emit('remove', path(field));
  if (field.type === 'path-image') emit('change', path(field));
}
const path = (field: Pick<SpecField, 'key'>) => props.prefix + field.key;
const stored = (field: Pick<SpecField, 'key'>) => {
  const { parent, key } = specFieldParent(props.content, path(field));
  return parent[key];
};
const value = (field: SpecField) => stored(field) ?? (field.required ? undefined : field.default);
</script>
