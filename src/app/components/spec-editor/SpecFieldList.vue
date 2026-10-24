<template>
  <div v-if="fields.length" class="ui-field-stack">
    <FieldRow
      v-for="field in fields"
      :key="field[0]"
      :label="field[1]"
      :field-key="field[0]"
      :path="path(field)"
      :required="field[4]"
      :layout="typeof field[2] === 'object' && !field[3] && (!Array.isArray(field[2]) || field[2].length !== 4) ? 'group' : 'row'"
    >
      <SchemaValueInput
        v-if="field[5]"
        :field="{ key: path(field), label: field[1], type: 'enum', required: field[4], source: field[5] }"
        :value="value(field)"
        :input-key="path(field)"
        :runtime-context="schemaRuntime"
        @update="$emit('update', path(field), $event.kind === 'set' ? String($event.value ?? '') : '')"
      />
      <n-select
        v-else-if="field[3]"
        :value="field[0] === 'textureType' && Array.isArray(value(field)) ? '自定义' : value(field)"
        :options="toOptions([...field[3], ...(field[0] === 'textureType' ? ['自定义'] : [])])"
        filterable
        :placeholder="placeholder(field)"
        :tag="field[0] === 'style' || field[0] === 'styleId'"
        :multiple="Array.isArray(field[2])"
        @update:value="$emit('update', path(field), field[0] === 'textureType' && $event === '自定义' ? ['', ''] : $event)"
      />
      <n-checkbox
        v-else-if="typeof field[2] === 'boolean'"
        :checked="value(field)"
        @update:checked="$emit('update', path(field), $event)"
      />
      <NumberValueInput
        v-else-if="typeof field[2] === 'number'"
        :value="value(field)"
        :label="field[1]"
        :input-key="path(field)"
        :clear-action="field[4] ? 'required' : 'null'"
        :placeholder="placeholder(field)"
        @update:value="$emit('update', path(field), $event)"
      />
      <ColorPicker
        v-else-if="Array.isArray(field[2]) && field[2].length === 4"
        :model-value="value(field) as JsonValue[]"
        :label="path(field)"
        @update:model-value="$emit('update', path(field), $event)"
      />
      <JsonValueInput
        v-else-if="typeof field[2] === 'object'"
        :value="value(field)"
        :label="path(field)"
        :shape="Array.isArray(field[2]) ? 'array' : 'object'"
        @update="$emit('update', path(field), $event)"
      />
      <slot v-else :name="field[0]" :value="value(field)" :path="path(field)"
        ><n-input
          :value="value(field)"
          :disabled="readonlyFields.includes(field[0])"
          :placeholder="placeholder(field)"
          @update:value="$emit('update', path(field), $event)"
          @change="$emit('change', path(field))"
      /></slot>
      <template #actions>
        <n-button v-if="imageFields.includes(field[0])" size="tiny" @click="$emit('browse', path(field))">浏览</n-button>
      </template>
      <template #hint><span v-if="stored(field) === undefined && field[4]" class="ui-text-muted ui-text-small">未设置</span></template>
    </FieldRow>
    <template
      v-for="field in fields.filter((item) => item[0] === 'textureType' && Array.isArray(stored(item)))"
      :key="path(field) + '-textures'"
    >
      <FieldRow
        v-for="index in [0, 1]"
        :key="index"
        :label="index === 0 ? '外围纹理' : '核心纹理'"
        :field-key="path(field) + '[' + index + ']'"
      >
        <n-input :value="(stored(field) as string[])[index]" @update:value="$emit('update', path(field) + '[' + index + ']', $event)" />
        <template #actions><n-button size="tiny" @click="$emit('browse', path(field) + '[' + index + ']')">浏览</n-button></template>
      </FieldRow>
    </template>
  </div>
</template>
<script setup lang="ts">
import { inject } from 'vue';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import { specSchemaContext } from '@/app/composables/spec-editor/spec-schema-context';
import FieldRow from '@/shared/ui/FieldRow.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import { toOptions } from '@/domain/editors/lib/editor-constants';
import { specFieldParent, type SpecField } from '@/domain/editors/spec-construction';
import type { JsonValue, RowData } from '@/shared/types';
const props = withDefaults(
  defineProps<{
    content: RowData;
    fields: SpecField[];
    prefix?: string;
    imageFields?: string[];
    readonlyFields?: string[];
  }>(),
  {
    prefix: '',
    imageFields: () => [],
    readonlyFields: () => [],
  },
);
const schemaRuntime = inject(specSchemaContext, null);
defineEmits<{ update: [path: string, value: JsonValue]; remove: [path: string]; browse: [path: string]; change: [path: string] }>();
const path = (field: SpecField) => props.prefix + field[0];
const stored = (field: SpecField) => {
  const { parent, key } = specFieldParent(props.content, path(field));
  return parent[key];
};
const value = (field: SpecField) => stored(field) ?? (field[4] ? undefined : field[2]);
const placeholder = (field: SpecField) =>
  stored(field) === undefined ? (field[4] ? '未设置' : '默认 ' + String(field[2] ?? '')) : undefined;
</script>
