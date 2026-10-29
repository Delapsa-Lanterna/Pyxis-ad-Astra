<template>
  <EditorCollapse :expanded-names="expanded" @update:expanded-names="collapse">
    <component
      v-for="row in rows"
      :key="row.id"
      :is="row.group ? NCollapseItem : SchemaFieldRow"
      v-memo="[row, runtimeContext, keyField]"
      v-bind="row.group || row.visible === false ? rowBindings(row) : { field: row.field, path: row.path }"
    >
      <template v-if="row.group || row.rename" #[row.labelSlot]>
        <SchemaScalarInput
          v-if="row.rename && !keyField.source"
          class="field-map-key-editor"
          :field="keyField"
          :validate="row.validateName"
          :value="row.key"
          :input-key="`${inputKey}/${row.id}/name`"
          @click.stop
          @update="rename(currentRow(row.id), $event)"
        />
        <n-select
          v-else-if="row.rename"
          class="field-map-key-editor"
          :value="row.key"
          :options="slotOptions.filter((option) => option.value === row.key || !names.has(option.value))"
          :render-label="renderSlotLabel"
          filterable
          size="small"
          @click.stop
          @update:value="rename(currentRow(row.id), { kind: 'set', value: $event })"
        />
        <span v-else>{{ row.field.label }}</span>
      </template>
      <template #[row.actionSlot]>
        <div v-if="row.remove" :class="row.group ? 'section-header-meta ui-control-row' : undefined" @click.stop>
          <n-button
            class="compact-icon-button ui-control-reset"
            size="tiny"
            quaternary
            :title="row.group ? '删除分组' : '删除'"
            @click.stop="remove(currentRow(row.id))"
          >
            <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </n-button>
        </div>
      </template>
      <slot :row="currentRow(row.id)" :update="(update: SchemaFieldUpdate) => updateRow(currentRow(row.id), update)" />
    </component>
    <div
      v-if="canAdd && field.editable !== false && field.operations?.add !== false && entries.length < (field.maxEntries ?? Infinity)"
      class="ui-control-row"
    >
      <n-select
        v-if="adding"
        ref="slotSelect"
        class="field-map-key-editor"
        :value="null"
        :options="availableSlots"
        :render-label="renderSlotLabel"
        :show="true"
        filterable
        size="small"
        placeholder="选择槽位"
        @update:value="add(adding!, $event)"
        @update:show="!$event && closeSlotSelect()"
        @keydown.esc="adding = null"
      />
      <template v-else v-for="choice in choices" :key="choice.label">
        <n-button
          :disabled="Boolean(keyField.source) && !availableSlots.length"
          size="tiny"
          @click="keyField.source ? (adding = choice) : add(choice)"
        >
          + {{ choice.label }}
        </n-button>
      </template>
    </div>
  </EditorCollapse>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import type { SelectInst } from 'naive-ui/es/select';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import SchemaFieldRow from './SchemaFieldRow.vue';
import SchemaScalarInput from './SchemaScalarInput.vue';
import { useSchemaSourceOptions } from '@/app/composables/editors/use-schema-source-options';
import { flattenSelectOptions, type FlatSelectOption } from '@/domain/schema/schema-options';
import { useEditorRowIdentities } from '@/app/composables/editors/use-editor-row-identities';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import {
  schemaCollection,
  schemaFieldRequired,
  schemaFieldVisible,
  schemaInitialValue,
  schemaFieldVariant,
  schemaKeyValueEntries,
  schemaKeyValueOutput,
} from '@/domain/schema/schema-values';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { RowData } from '@/shared/types';

const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  inputKey: string;
  fieldPath: string;
  runtimeContext?: SchemaRuntimeContext | null;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const inputs = useFieldInputs();
const mode = useInputEditMode();
const array = computed(() => props.field.type === 'array');
const allowExtraFields = computed(() => mode.value === 'plain' || props.field.allowExtraFields === true);
const canAdd = computed(() => array.value || (allowExtraFields.value && !rows.value.some((row) => row.id === '__extra')));
const format = computed(() => (props.value === undefined || Array.isArray(props.value) ? props.field.format : undefined));
const fields = computed(() => props.field.nested ?? []);
const item = computed<FieldSchema>(
  () => props.field.item ?? props.field.valueSchema ?? { key: 'value', label: '内容', type: 'json', default: null },
);
const entries = computed(() =>
  (array.value
    ? Array.isArray(props.value)
      ? props.value.map((val, index) => ({ key: String(index), val }))
      : []
    : schemaKeyValueEntries(props.value, format.value)
  ).map((entry, index) => ({ ...entry, index })),
);
const fixedByKey = computed(() => new Map(fields.value.map((field) => [field.key, field])));
const positions = computed(() => new Map(entries.value.map((entry, index) => [entry.key, index])));
const names = computed(
  () => new Set([...entries.value.map((entry) => entry.key), ...fixedByKey.value.keys(), ...(props.field.reservedKeys ?? [])]),
);
const dynamic = computed(() =>
  entries.value.filter((entry) => array.value || (allowExtraFields.value && !fixedByKey.value.has(entry.key))),
);
const keyField = computed<FieldSchema>(() => ({
  ...props.field.keySchema,
  key: 'name',
  label: props.field.keySchema?.label ?? '名称',
  type: props.field.keySchema?.type ?? 'string',
  required: true,
  reservedKeys: [...(props.field.reservedKeys ?? []), ...fixedByKey.value.keys()],
}));
const { sourceOptions } = useSchemaSourceOptions({
  field: () => keyField.value,
  value: () => undefined,
  runtimeContext: () => props.runtimeContext,
});
const slotOptions = computed(() => flattenSelectOptions(sourceOptions.value));
const availableSlots = computed(() => slotOptions.value.filter((option) => !names.value.has(option.value)));
const adding = shallowRef<FieldSchema | null>(null);
function renderSlotLabel(option: FlatSelectOption, selected: boolean) {
  return selected ? option.value : option.label;
}
const slotSelect = ref<SelectInst | null>(null);
async function closeSlotSelect() {
  // Select closes its menu before delivering the selected value.
  await nextTick();
  adding.value = null;
}
watch(slotSelect, (select) => select?.focusInput(), { flush: 'post' });
watch(
  () => [props.inputKey, props.fieldPath, props.runtimeContext?.sessionId, props.runtimeContext?.sourceContextKey, sourceOptions.value],
  () => (adding.value = null),
);
interface Row {
  visible?: boolean;
  mounted?: boolean;
  id: string;
  key: string;
  value: unknown;
  field: FieldSchema;
  variable: boolean;
  index: number;
  group: boolean;
  labelSlot: string;
  actionSlot: string;
  rename: boolean;
  remove: boolean;
  path: string;
  inputKey: string;
  validateName: (value: unknown) => string | null;
}
function rowBindings(row: Row) {
  const bindings = row.group ? { name: row.id, title: row.field.label, class: 'schema-section' } : { field: row.field, path: row.path };
  return row.visible === false ? { ...bindings, class: [bindings.class, 'ui-retained-hidden'] } : bindings;
}
const identity = useEditorRowIdentities(
  () => (array.value ? dynamic.value.map((entry) => entry.val) : dynamic.value),
  array.value ? undefined : (value) => (value as { key: string }).key,
);
const choices = computed(
  () => item.value.variants ?? [{ ...item.value, label: props.field.presentation === 'groups' ? '添加分组' : '添加项' }],
);
const groupStates = ref(new Map<string, boolean>());
const rows = computed<Row[]>((previous) => {
  const before = new Map(previous?.map((row) => [row.id, row]));
  function makeRow(
    key: string,
    value: unknown,
    definition: FieldSchema,
    id: string,
    variable: boolean,
    index = positions.value.get(key) ?? -1,
  ): Row {
    const old = before.get(id);
    const resolved = definition.variants ? schemaFieldVariant(definition, value) : definition;
    const field = {
      ...resolved,
      ...(resolved.requiredWhen
        ? {
            required: schemaFieldRequired(
              resolved,
              (key) => entries.value[positions.value.get(key) ?? -1]?.val ?? fixedByKey.value.get(key)?.default,
            ),
          }
        : {}),
      ...(array.value ? { key: '', label: schemaCollection(resolved) ? `${resolved.label} ${index + 1}` : `#${index + 1}` } : {}),
      ...(props.field.editable === false ? { editable: false } : {}),
      ...(props.field.partial ? { required: false } : {}),
    };
    const group = props.field.presentation === 'groups' ? !variable || field.type === 'object' : variable && schemaCollection(field);
    const row: Row = {
      id,
      key,
      value,
      field,
      variable,
      index,
      group,
      labelSlot: group ? 'header' : 'label',
      actionSlot: group ? 'header-extra' : 'actions',
      rename: variable && !array.value && props.field.editable !== false && props.field.operations?.rename !== false,
      remove:
        props.field.editable !== false &&
        props.field.operations?.remove !== false &&
        (variable || (index >= 0 && !field.required && props.field.presentation !== 'groups')),
      path: `${props.fieldPath}[${array.value ? key : JSON.stringify(key)}]`,
      inputKey: `${props.inputKey}/${id}`,
      validateName:
        old?.validateName ??
        ((value) =>
          !format.value && String(value) !== currentRow(id).key && names.value.has(String(value)) ? '名称重复或为保留名称' : null),
    };
    if (definition.visibleWhen) {
      row.visible = schemaFieldVisible(definition.visibleWhen, props.runtimeContext?.readValue?.() ?? (props.value as RowData));
      row.mounted = row.visible || Boolean(old?.mounted);
    }
    if (old) {
      if (stableDeepEqual(old.field, field)) row.field = old.field;
      if (stableDeepEqual(old.value, value, true)) row.value = old.value;
      if (Object.keys(row).every((key) => row[key as keyof Row] === old[key as keyof Row])) return old;
    }
    return row;
  }
  const fixed: Row[] = [];
  if (!array.value)
    for (const field of fields.value) {
      const row = makeRow(field.key, entries.value[positions.value.get(field.key) ?? -1]?.val, field, 'field:' + field.key, false);
      if (row.mounted !== false) fixed.push(row);
    }
  const variable = dynamic.value.map((entry, index) =>
    makeRow(entry.key, entry.val, item.value, String(identity.identities.value[index]), true, entry.index),
  );
  const grouped = props.field.presentation === 'groups';
  if (!grouped && (!fixed.length || !allowExtraFields.value)) return [...fixed, ...variable];
  const groups = grouped ? variable.filter((row) => row.group) : [];
  const extra = grouped ? variable.filter((row) => !row.group) : variable;
  return [
    ...fixed,
    ...groups,
    ...((mode.value === 'smart' ? props.field.allowExtraFields === true : extra.length > 0)
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
                allowExtraFields: true,
                valueSchema: item.value,
                operations: props.field.operations,
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
const rowById = computed(() => new Map(rows.value.map((row) => [row.id, row])));
function currentRow(id: string) {
  return rowById.value.get(id)!;
}

const expanded = computed(() =>
  rows.value.filter((row) => row.group && (groupStates.value.get(row.id) ?? !row.variable)).map((row) => row.id),
);
function collapse(names: (string | number)[]) {
  const opened = new Set(names);
  groupStates.value = new Map(rows.value.filter((row) => row.group).map((row) => [row.id, opened.has(row.id)]));
}
watch(
  () => rows.value.filter((row) => row.group).map((row) => row.id),
  (next, previous) => {
    if (!previous) return;
    const existing = new Set(previous);
    const retained = new Set(next);
    for (const id of groupStates.value.keys()) if (!retained.has(id)) groupStates.value.delete(id);
    for (const id of next) if (!existing.has(id)) groupStates.value.set(id, true);
  },
);

function publish(next: { key: string; val: unknown }[], operation?: { kind: 'insert' | 'remove'; index: number }) {
  identity.commit(array.value ? next.map((entry) => entry.val) : next.filter((entry) => !fixedByKey.value.has(entry.key)), operation);
  emit('update', { kind: 'set', value: array.value ? next.map((entry) => entry.val) : schemaKeyValueOutput(next, format.value) });
}
function updateRow(row: Row, update: SchemaFieldUpdate) {
  if (update.kind === 'remove') return remove(row);
  if (row.id === '__extra') {
    const retainedKeys = new Set(rows.value.filter((row) => row.id !== '__extra').map((row) => row.key));
    const retained = entries.value.filter((entry) => retainedKeys.has(entry.key));
    return publish([...retained, ...schemaKeyValueEntries(update.value, undefined)]);
  }
  const next = entries.value
    .map((entry, index) => (index === row.index ? { ...entry, val: update.value } : entry))
    .filter(
      (entry) => !props.field.exclusiveKeys?.includes(row.key) || entry.key === row.key || !props.field.exclusiveKeys.includes(entry.key),
    );
  if (row.index < 0) next.push({ key: row.key, val: update.value, index: next.length });
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
    row.variable ? { kind: 'remove', index: dynamic.value.findIndex((entry) => entry.index === row.index) } : undefined,
  );
}
function add(choice: FieldSchema, selected?: string) {
  adding.value = null;
  const initial = selected ?? (props.field.keySchema ? schemaInitialValue(props.field.keySchema) : 'newField');
  let key = array.value ? String(entries.value.length) : String(initial);
  for (let index = 1; names.value.has(key); index++) key = typeof initial === 'number' ? String(initial + index) : initial + String(index);
  publish([...entries.value, { key, val: schemaInitialValue(choice) }], { kind: 'insert', index: dynamic.value.length });
}
</script>
