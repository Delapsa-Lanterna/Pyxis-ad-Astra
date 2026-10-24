<template>
  <EditorCollapse :expanded-names="expanded" @update:expanded-names="collapse">
    <template v-for="row in rows" :key="row.id">
      <n-collapse-item v-if="row.group" :name="row.id" :title="row.field.label" class="schema-section">
        <template #header>
          <SchemaScalarInput
            v-if="row.rename"
            class="field-map-key-editor"
            :field="nameField(currentRow(row.id))"
            :value="currentRow(row.id).key"
            :input-key="`${inputKey}/${row.id}/name`"
            @click.stop
            @update="rename(currentRow(row.id), $event)"
          />
          <span v-else>{{ row.field.label }}</span>
        </template>
        <template #header-extra>
          <div v-if="row.remove" class="section-header-meta ui-control-row" @click.stop>
            <n-button class="compact-icon-button ui-control-reset" size="tiny" quaternary title="删除分组" @click.stop="remove(row)">
              <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </n-button>
          </div>
        </template>
        <slot :row="currentRow(row.id)" :update="(update: SchemaFieldUpdate) => updateRow(currentRow(row.id), update)" />
      </n-collapse-item>
      <SchemaFieldRow v-else :field="row.field" :path="row.path">
        <template v-if="row.rename" #label>
          <SchemaScalarInput
            class="field-map-key-editor"
            :field="nameField(row)"
            :value="row.key"
            :input-key="`${inputKey}/${row.id}/name`"
            @update="rename(row, $event)"
          />
        </template>
        <slot :row="row" :update="(update: SchemaFieldUpdate) => updateRow(row, update)" />
        <template #actions>
          <n-button v-if="row.remove" class="compact-icon-button ui-control-reset" size="tiny" quaternary title="删除" @click="remove(row)">
            <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </n-button>
        </template>
      </SchemaFieldRow>
    </template>
    <div v-if="field.editable !== false && field.operations?.add !== false" class="ui-control-row">
      <n-button v-for="choice in choices" :key="choice.label" size="tiny" @click="add(choice)">+ {{ choice.label }}</n-button>
    </div>
  </EditorCollapse>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import SchemaFieldRow from './SchemaFieldRow.vue';
import SchemaScalarInput from './SchemaScalarInput.vue';
import { useEditorRowIdentities } from '@/app/composables/editors/use-editor-row-identities';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import {
  schemaCollection,
  schemaInitialValue,
  schemaFieldVariant,
  schemaKeyValueEntries,
  schemaKeyValueOutput,
} from '@/domain/schema/schema-values';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';

const props = defineProps<{ field: FieldSchema; value: unknown; inputKey: string; fieldPath: string }>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const inputs = useFieldInputs();
const array = computed(() => props.field.type === 'array');
const format = computed(() => (props.value === undefined || Array.isArray(props.value) ? props.field.format : undefined));
const fields = computed(() => props.field.nested ?? []);
const item = computed<FieldSchema>(
  () => props.field.item ?? props.field.valueSchema ?? { key: 'value', label: '内容', type: 'json', default: null },
);
const entries = computed(() =>
  array.value
    ? Array.isArray(props.value)
      ? props.value.map((val, index) => ({ key: String(index), val }))
      : []
    : schemaKeyValueEntries(props.value, format.value),
);
const dynamic = computed(() => entries.value.filter((entry) => array.value || !fields.value.some((field) => field.key === entry.key)));
const identity = useEditorRowIdentities(
  () => (array.value ? dynamic.value.map((entry) => entry.val) : dynamic.value),
  array.value ? undefined : (value) => (value as { key: string }).key,
);
const choices = computed(
  () => item.value.variants ?? [{ ...item.value, label: props.field.presentation === 'groups' ? '添加分组' : '添加项' }],
);
const collapsed = ref<(string | number)[]>([]);
const rows = computed(() => {
  const fixed = array.value
    ? []
    : fields.value.map((field) =>
        makeRow(field.key, entries.value.find((entry) => entry.key === field.key)?.val, field, 'field:' + field.key, false),
      );
  const variable = dynamic.value.map((entry, index) =>
    makeRow(entry.key, entry.val, item.value, String(identity.identities.value[index]), true, entries.value.indexOf(entry)),
  );
  if (props.field.presentation !== 'groups') return [...fixed, ...variable];
  const groups = variable.filter((row) => row.group);
  const extra = variable.filter((row) => !row.group);
  return [
    ...fixed,
    ...groups,
    ...(extra.length
      ? [
          {
            ...makeRow(
              '__extra',
              schemaKeyValueOutput(
                extra.map((row) => ({ key: row.key, val: row.value })),
                undefined,
              ),
              {
                key: '__extra',
                label: '额外字段',
                type: 'object',
                valueSchema: item.value,
                reservedKeys: [
                  ...(props.field.reservedKeys ?? []),
                  ...fields.value.map((field) => field.key),
                  ...groups.map((row) => row.key),
                ],
              },
              '__extra',
              false,
            ),
            group: true,
          },
        ]
      : []),
  ];
});
type Row = ReturnType<typeof makeRow>;
function currentRow(id: string) {
  return rows.value.find((row) => row.id === id)!;
}
function makeRow(
  key: string,
  value: unknown,
  definition: FieldSchema,
  id: string,
  variable: boolean,
  index = entries.value.findIndex((entry) => entry.key === key),
) {
  const resolved = definition.variants ? schemaFieldVariant(definition, value) : definition;
  const field = {
    ...resolved,
    ...(array.value ? { key: '', label: schemaCollection(resolved) ? `${resolved.label} ${index + 1}` : `#${index + 1}` } : {}),
    ...(props.field.editable === false ? { editable: false } : {}),
  };
  return {
    id,
    key,
    value,
    field,
    variable,
    index,
    group: props.field.presentation === 'groups' ? !variable || field.type === 'object' : variable && schemaCollection(field),
    rename: variable && !array.value && props.field.editable !== false && props.field.operations?.rename !== false,
    remove:
      props.field.editable !== false &&
      props.field.operations?.remove !== false &&
      (variable || (index >= 0 && !field.required && props.field.presentation !== 'groups')),
    path: `${props.fieldPath}[${array.value ? key : JSON.stringify(key)}]`,
    inputKey: `${props.inputKey}/${id}`,
  };
}
const expanded = computed(() => rows.value.filter((row) => row.group && !collapsed.value.includes(row.id)).map((row) => row.id));
function collapse(names: (string | number)[]) {
  collapsed.value = rows.value.filter((row) => row.group && !names.includes(row.id)).map((row) => row.id);
}
function nameField(row: Row): FieldSchema {
  return {
    key: 'name',
    label: '名称',
    type: 'string',
    required: true,
    reservedKeys: [
      ...(props.field.reservedKeys ?? []),
      ...fields.value.map((field) => field.key),
      ...(!format.value ? entries.value.filter((entry) => entry.key !== row.key).map((entry) => entry.key) : []),
    ],
  };
}
function publish(next: { key: string; val: unknown }[], operation?: { kind: 'insert' | 'remove'; index: number }) {
  identity.commit(
    array.value ? next.map((entry) => entry.val) : next.filter((entry) => !fields.value.some((field) => field.key === entry.key)),
    operation,
  );
  emit('update', { kind: 'set', value: array.value ? next.map((entry) => entry.val) : schemaKeyValueOutput(next, format.value) });
}
function updateRow(row: Row, update: SchemaFieldUpdate) {
  if (update.kind === 'remove') return remove(row);
  if (row.id === '__extra') {
    const retained = entries.value.filter((entry) => rows.value.some((row) => row.id !== '__extra' && row.key === entry.key));
    return publish([...retained, ...schemaKeyValueEntries(update.value, undefined)]);
  }
  const next = entries.value.map((entry, index) => (index === row.index ? { ...entry, val: update.value } : entry));
  if (row.index < 0) next.push({ key: row.key, val: update.value });
  publish(next);
}
function rename(row: Row, update: SchemaFieldUpdate) {
  if (update.kind === 'set')
    publish(entries.value.map((entry, index) => (index === row.index ? { ...entry, key: String(update.value) } : entry)));
}
function remove(row: Row) {
  inputs?.cancel(row.inputKey);
  publish(
    entries.value.filter((_, index) => index !== row.index),
    row.variable ? { kind: 'remove', index: dynamic.value.indexOf(entries.value[row.index]!) } : undefined,
  );
}
function add(choice: FieldSchema) {
  const occupied = [
    ...entries.value.map((entry) => entry.key),
    ...fields.value.map((field) => field.key),
    ...(props.field.reservedKeys ?? []),
  ];
  let key = array.value ? String(entries.value.length) : 'newField';
  for (let index = 1; occupied.includes(key); index++) key = 'newField' + index;
  publish([...entries.value, { key, val: schemaInitialValue(choice) }], { kind: 'insert', index: dynamic.value.length });
}
</script>
