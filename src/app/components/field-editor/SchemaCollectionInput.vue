<template>
  <EditorCollapse v-model:expanded-names="expanded">
    <component
      v-for="row in rows"
      :is="row.group ? EditorCollapseItem : SchemaFieldRow"
      :key="row.id"
      v-memo="[row, runtimeContext]"
      v-bind="
        row.group
          ? { name: row.id, title: row.field.label, class: 'schema-section', 'data-field-path': row.path }
          : { field: row.field, path: row.path }
      "
      :class="{ 'ui-retained-hidden': !row.visible }"
    >
      <template v-if="row.group || (row.dynamic && !array)" #[row.labelSlot]>
        <SchemaScalarInput
          v-if="row.dynamic && !array && !keyField.source"
          class="field-map-key-editor"
          :field="keyField"
          :value="row.key"
          :input-key="`${inputKey}/${row.id}/key`"
          :validate="(value) => validateName(row, String(value))"
          @update="rename(row, $event)"
          @click.stop
        />
        <n-select
          v-else-if="row.dynamic && !array"
          class="field-map-key-editor"
          :value="row.key"
          :options="slotOptions.filter((option) => option.value === row.key || !entries.some((entry) => entry.key === option.value))"
          :render-label="renderSelectLabel"
          filterable
          size="small"
          @click.stop
          @update:value="rename(row, { kind: 'set', value: $event })"
        />
        <span v-else>{{ row.field.label }}</span>
      </template>
      <template #[row.actionSlot]>
        <div class="ui-control-row" @click.stop>
          <n-button
            v-if="row.remove"
            class="compact-icon-button ui-control-reset"
            size="tiny"
            quaternary
            :title="row.dynamic ? '删除条目' : '移除字段'"
            :aria-label="row.dynamic ? '删除条目' : '移除字段'"
            @click="remove(row)"
          >
            <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m3 3v7m6-7v7" />
            </svg>
          </n-button>
        </div>
      </template>
      <slot :row="row" :origin="row.origin" :update="(update: SchemaFieldUpdate) => updateRow(row, update)" />
    </component>
    <div v-if="canAdd" class="ui-control-row">
      <n-select
        v-if="adding"
        ref="slotSelect"
        class="field-map-key-editor"
        :value="null"
        :options="availableSlots"
        :show="true"
        filterable
        size="small"
        placeholder="选择槽位"
        :render-label="renderSelectLabel"
        @update:value="add(adding!, $event)"
        @update:show="!$event && closeSlotSelect()"
        @keydown.esc="adding = null"
      />
      <template v-else>
        <n-button
          v-for="choice in choices"
          :key="choice.label"
          size="tiny"
          :disabled="Boolean(keyField.source) && !availableSlots.length"
          @click="keyField.source ? (adding = choice) : add(choice)"
          >+ {{ choice.label }}</n-button
        >
      </template>
    </div>
  </EditorCollapse>
</template>
<script setup lang="ts">
import { computed, ref, watch, shallowRef, nextTick } from 'vue';
import type { SelectInst, SelectRenderLabel } from 'naive-ui/es/select';
import { useFieldSourceOptions } from '@/app/composables/field-editor/use-field-source-options';
import { flattenSelectOptions } from '@/domain/field-editor/field-options';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import EditorCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import SchemaFieldRow from './SchemaFieldRow.vue';
import SchemaScalarInput from './SchemaScalarInput.vue';
import { fieldCompositionOrigin, fieldDocumentPath, type FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useFieldEditMode } from '@/app/composables/field-editor/use-field-edit-mode';
import {
  schemaCollection,
  schemaFieldRequired,
  schemaFieldVisible,
  schemaFieldVariant,
  schemaInitialValue,
  schemaKeyValueEntries,
  schemaKeyValueOutput,
} from '@/domain/schema/schema-values';
import { prepareSchemaValue, prepareValue } from '@/domain/schema/game-number';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { DocumentEdit, FilePath } from '@/shared/types';
import type { RowData } from '@/shared/types';
const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  inputKey: string;
  fieldPath: string;
  runtimeContext?: FieldEditorContext | null;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const renderSelectLabel: SelectRenderLabel = (option, selected) => String(selected ? option.value : option.label);
const inputs = useFieldInputs(),
  mode = useFieldEditMode();
const array = computed(() => props.field.type === 'array');
const format = computed(() => (Array.isArray(props.value) || props.value === undefined ? props.field.format : undefined));
const entries = computed(() =>
  array.value
    ? Array.isArray(props.value)
      ? props.value.map((val, index) => ({ key: String(index), val }))
      : []
    : schemaKeyValueEntries(props.value, format.value),
);
const definitions = computed(() => props.field.nested ?? []);
const item = computed<FieldSchema>(() => props.field.item ?? props.field.valueSchema ?? { key: 'value', label: '内容', type: 'json' });
const keyField = computed<FieldSchema>(() => ({ key: 'name', label: '名称', type: 'string', required: true, ...props.field.keySchema }));
const { sourceOptions } = useFieldSourceOptions({
  field: () => keyField.value,
  value: () => undefined,
  runtimeContext: () => props.runtimeContext,
});
const slotOptions = computed(() => flattenSelectOptions(sourceOptions.value));
const availableSlots = computed(() => slotOptions.value.filter((option) => !entries.value.some((entry) => entry.key === option.value)));
const adding = shallowRef<FieldSchema | null>(null),
  slotSelect = ref<SelectInst | null>(null);
async function closeSlotSelect() {
  await nextTick();
  adding.value = null;
}
watch(slotSelect, (select) => select?.focusInput(), { flush: 'post' });
watch(
  () => [props.inputKey, props.fieldPath, props.runtimeContext?.sessionId, props.runtimeContext?.sourceContextKey, sourceOptions.value],
  () => {
    adding.value = null;
  },
);
const choices = computed(
  () => item.value.variants ?? [{ ...item.value, label: props.field.presentation === 'groups' ? '添加分组' : '添加项' }],
);
const canAdd = computed(
  () =>
    props.field.editable !== false &&
    props.field.operations?.add !== false &&
    entries.value.length < (props.field.maxEntries ?? Infinity) &&
    (array.value || mode.value === 'plain' || props.field.allowExtraFields === true) &&
    !rows.value.some((row) => row.id === '__extra'),
);
const groupStates = ref(new Map<string, boolean>());
interface Row {
  id: string;
  key: string;
  index: number;
  sourceIndex: number;
  value: unknown;
  field: FieldSchema;
  path: string;
  inputKey: string;
  dynamic: boolean;
  labelSlot: string;
  actionSlot: string;
  group: boolean;
  remove: boolean;
  origin: string | null;
  visible: boolean;
}
const filePath = computed<FilePath | null>(() => {
  const context = props.runtimeContext;
  const path = context ? fieldDocumentPath(context, props.fieldPath) : null;
  return path && context?.document?.find(path) ? path : null;
});
const rows = computed<Row[]>((previous) => {
  const before = new Map(previous?.map((row) => [row.id, row]));
  const fixed = new Map(definitions.value.map((field) => [field.key, field]));
  const sourceNode = props.runtimeContext?.document && filePath.value ? props.runtimeContext.document.find(filePath.value) : null;
  const ids =
    sourceNode?.content.kind === 'array'
      ? sourceNode.content.value.map((node) => String(node.id))
      : sourceNode?.content.kind === 'object'
        ? sourceNode.content.value.map(([, node]) => String(node.id))
        : [];
  const values = array.value
    ? entries.value
    : [
        ...definitions.value.map((field) => ({ key: field.key, val: entries.value.find((entry) => entry.key === field.key)?.val })),
        ...entries.value.filter((entry) => !fixed.has(entry.key) && (mode.value === 'plain' || props.field.allowExtraFields === true)),
      ];
  const all = values
    .map((entry, displayIndex): Row => {
      const index = entries.value.findIndex((value) => value.key === entry.key),
        definition = fixed.get(entry.key) ?? item.value;
      const field = definition.variants ? schemaFieldVariant(definition, entry.val) : definition;
      const dynamic = array.value || !fixed.has(entry.key);
      const sourceIndex = sourceNode?.content.kind === 'object' ? sourceNode.content.value.findIndex(([key]) => key === entry.key) : index;
      const id = dynamic ? (ids[sourceIndex] ?? `${props.inputKey}:${array.value ? index : entry.key}`) : `field:${entry.key}`;
      const path =
        format.value === 'array-of-entries'
          ? `${props.fieldPath}[${index}][${JSON.stringify(entry.key)}]`
          : `${props.fieldPath}[${array.value ? entry.key : JSON.stringify(entry.key)}]`;
      const group = props.field.presentation === 'groups' ? !dynamic || field.type === 'object' : dynamic && schemaCollection(field);
      const current: Row = {
        id,
        key: entry.key,
        index,
        sourceIndex,
        value: entry.val,
        dynamic,
        labelSlot: group ? 'header' : 'label',
        actionSlot: group ? 'header-extra' : 'actions',
        path,
        inputKey: `${props.inputKey}/${id}`,
        field: {
          ...field,
          required: schemaFieldRequired(field, (key) => entries.value.find((entry) => entry.key === key)?.val),
          ...(array.value ? { key: '', label: `${field.label} ${displayIndex + 1}` } : {}),
          ...(props.field.partial || props.runtimeContext?.partial ? { partial: true, required: false, requiredWhen: undefined } : {}),
        },
        origin: fieldCompositionOrigin(props.runtimeContext, path),
        group,
        remove:
          fieldCompositionOrigin(props.runtimeContext, path) === null &&
          props.field.editable !== false &&
          props.field.operations?.remove !== false &&
          index >= 0 &&
          (dynamic || (!field.required && props.field.presentation !== 'groups')),
        visible: schemaFieldVisible(field.visibleWhen, props.runtimeContext?.readValue?.() ?? (props.value as RowData)),
      };
      const old = before.get(id);
      return old && stableDeepEqual(old, current, true) ? old : current;
    })
    .filter((row) => row.visible || before.has(row.id));
  const fixedRows = all.filter((row) => !row.dynamic),
    variableRows = all.filter((row) => row.dynamic);
  const grouped = props.field.presentation === 'groups';
  if (!grouped && (!fixedRows.length || props.field.allowExtraFields !== true)) return all;
  const groups = grouped ? variableRows.filter((row) => row.group) : [];
  const extra = grouped ? variableRows.filter((row) => !row.group) : variableRows;
  if (mode.value === 'smart' ? props.field.allowExtraFields !== true : !extra.length) return [...fixedRows, ...groups];
  const extraRow: Row = {
    id: '__extra',
    key: '__extra',
    index: -1,
    sourceIndex: -1,
    dynamic: false,
    group: true,
    value: schemaKeyValueOutput(
      extra.map((row) => ({ key: row.key, val: row.value })),
      undefined,
    ),
    field: {
      key: '__extra',
      label: '额外字段',
      type: 'object',
      allowExtraFields: true,
      valueSchema: item.value,
      operations: props.field.operations,
      reservedKeys: [...(props.field.reservedKeys ?? []), ...fixedRows.map((row) => row.key), ...groups.map((row) => row.key)],
    },
    path: props.fieldPath,
    inputKey: `${props.inputKey}/__extra`,
    labelSlot: 'header',
    actionSlot: 'header-extra',
    remove: false,
    origin: null,
    visible: true,
  };
  return [...fixedRows, ...groups, extraRow];
});
const expanded = computed({
  get: () => rows.value.filter((row) => row.group && (groupStates.value.get(row.id) ?? !row.dynamic)).map((row) => row.id),
  set: (names: (string | number)[]) => {
    groupStates.value = new Map(rows.value.filter((row) => row.group).map((row) => [row.id, names.includes(row.id)]));
  },
});
watch(
  () => rows.value.filter((row) => row.group).map((row) => row.id),
  (next, before) => {
    const known = new Set(before),
      retained = new Set(next);
    for (const key of groupStates.value.keys()) if (!retained.has(key)) groupStates.value.delete(key);
    for (const key of next) if (!known.has(key)) groupStates.value.set(key, true);
  },
);
function publish(next: { key: string; val: unknown }[], fileEdit?: DocumentEdit) {
  emit('update', {
    kind: 'set',
    value: array.value ? next.map((entry) => entry.val) : schemaKeyValueOutput(next, format.value),
    ...(fileEdit ? { fileEdit } : {}),
  });
}
function updateRow(row: Row, update: SchemaFieldUpdate) {
  row = rows.value.find((current) => current.id === row.id)!;
  if (update.kind === 'remove') return remove(row);
  if (row.id === '__extra') {
    const retained = new Set(rows.value.filter((row) => row.id !== '__extra').map((row) => row.key));
    publish(
      [...entries.value.filter((entry) => retained.has(entry.key)), ...schemaKeyValueEntries(update.value, undefined)],
      update.fileEdit,
    );
    return;
  }
  const exclusive = props.field.exclusiveKeys?.includes(row.key) ? props.field.exclusiveKeys : [];
  const removesExclusive = entries.value.some((entry) => entry.key !== row.key && exclusive.includes(entry.key));
  const next = entries.value.filter((entry) => entry.key === row.key || !exclusive.includes(entry.key));
  if (row.index < 0) {
    next.push({ key: row.key, val: update.value });
    const edit = filePath.value
      ? {
          kind: 'objectSplice' as const,
          path: filePath.value,
          index: entries.value.length,
          delete: 0,
          insert: [[row.key, prepareSchemaValue(update.value, row.field)] as [string, ReturnType<typeof prepareSchemaValue>]],
        }
      : undefined;
    publish(next, removesExclusive ? undefined : edit);
    return;
  }
  const index = next.findIndex((entry) => entry.key === row.key);
  next[index] = { key: row.key, val: update.value };
  const edit =
    update.fileEdit ??
    (filePath.value
      ? {
          kind: 'replace' as const,
          path: [...filePath.value, ...(format.value === 'array-of-entries' ? [String(row.index)] : []), row.key],
          value: prepareSchemaValue(update.value, row.field),
        }
      : undefined);
  publish(next, removesExclusive ? undefined : edit);
}
function remove(row: Row) {
  row = rows.value.find((current) => current.id === row.id)!;
  inputs?.cancel(row.inputKey);
  const next = entries.value.filter((_, index) => index !== row.index);
  const edit = filePath.value
    ? array.value || format.value === 'array-of-entries'
      ? { kind: 'arraySplice' as const, path: filePath.value, index: row.sourceIndex, delete: 1, insert: [] }
      : { kind: 'objectSplice' as const, path: filePath.value, index: row.sourceIndex, delete: 1, insert: [] }
    : undefined;
  publish(next, edit);
}
function validateName(row: Row, name: string) {
  return name !== row.key &&
    (entries.value.some((entry) => entry.key === name) ||
      definitions.value.some((field) => field.key === name) ||
      props.field.reservedKeys?.includes(name))
    ? '名称重复或为保留名称'
    : null;
}
function rename(row: Row, update: SchemaFieldUpdate) {
  row = rows.value.find((current) => current.id === row.id)!;
  if (update.kind !== 'set') return;
  const key = String(update.value),
    next = [...entries.value];
  next[row.index] = { key, val: row.value };
  const previous = filePath.value
    ? props.runtimeContext!.document!.prepared([
        ...filePath.value,
        ...(format.value === 'array-of-entries' ? [String(row.index)] : []),
        row.key,
      ])
    : prepareSchemaValue(row.value, row.field);
  const edit = filePath.value
    ? {
        kind: 'objectSplice' as const,
        path: format.value === 'array-of-entries' ? [...filePath.value, String(row.sourceIndex)] : filePath.value,
        index: format.value === 'array-of-entries' ? 0 : row.sourceIndex,
        delete: 1,
        insert: [[key, previous] as [string, typeof previous]],
      }
    : undefined;
  publish(next, edit);
}
function add(choice: FieldSchema, selected?: string) {
  adding.value = null;
  const initial = selected ?? (props.field.keySchema ? schemaInitialValue(props.field.keySchema) : 'newField');
  let key = array.value ? String(entries.value.length) : String(initial);
  for (
    let sequence = 1;
    entries.value.some((entry) => entry.key === key) || definitions.value.some((field) => field.key === key);
    sequence++
  )
    key = typeof initial === 'number' ? String(initial + sequence) : `${String(initial)}${sequence}`;
  const value = schemaInitialValue(choice),
    prepared = prepareSchemaValue(value, choice),
    index = entries.value.length;
  const edit = filePath.value
    ? array.value || format.value === 'array-of-entries'
      ? {
          kind: 'arraySplice' as const,
          path: filePath.value,
          index,
          delete: 0,
          insert: [
            array.value
              ? prepared
              : {
                  value: { kind: 'object' as const, value: [[key, prepared.value]] as [string, typeof prepared.value][] },
                  target: {
                    ...prepareValue({}).target,
                    children: { kind: 'object' as const, items: [[key, prepared.target]] as [string, typeof prepared.target][] },
                  },
                },
          ],
        }
      : { kind: 'objectSplice' as const, path: filePath.value, index, delete: 0, insert: [[key, prepared] as [string, typeof prepared]] }
    : undefined;
  publish([...entries.value, { key, val: value }], edit);
}
</script>
