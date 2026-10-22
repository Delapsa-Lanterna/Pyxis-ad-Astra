<template>
  <template v-if="plainMode">
    <n-input
      v-if="field.type === 'string'"
      :value="strVal"
      type="textarea"
      :autosize="stringTextareaAutosize"
      size="small"
      :disabled="field.editable === false"
      @update:value="emitValue($event)"
    />
    <n-input
      v-else-if="field.type === 'text'"
      :value="strVal"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 6 }"
      size="small"
      @update:value="emitValue($event)"
    />
    <SchemaScalarInput
      v-else-if="field.type === 'integer' || field.type === 'float' || field.type === 'boolean'"
      :field="field"
      :value="props.value"
      :input-key="fieldInputKey"
      @update="emit('update', $event)"
    />
    <n-input
      v-else-if="field.type === 'enum'"
      :value="strVal"
      size="small"
      :disabled="field.editable === false"
      @update:value="emitValue($event)"
    />
    <JsonValueInput
      v-else-if="field.type === 'color-rgb' || field.type === 'color-rgba'"
      :value="props.value"
      :label="field.label"
      :input-key="fieldInputKey"
      shape="array"
      @update="emitValue($event)"
    />
    <n-input
      v-else-if="field.type === 'path-image' || field.type === 'path'"
      :value="strVal"
      size="small"
      @update:value="emitValue($event)"
    />
    <n-input
      v-else-if="field.type === 'string-array'"
      :value="formatSchemaCommaList(arrVal)"
      size="small"
      @update:value="emitPlainStringArray"
    />
    <n-input
      v-else-if="field.type === 'tag-select'"
      :value="formatSchemaCommaList(tagSelectVal)"
      size="small"
      @update:value="emitPlainTagSelect"
    />
    <JsonValueInput
      v-else-if="field.type === 'key-value' || field.type === 'object' || field.type === 'array' || field.type === 'array-of-object'"
      :value="props.value"
      :label="field.label"
      :input-key="fieldInputKey"
      :shape="jsonShape"
      @update="emitValue($event)"
    />
    <JsonValueInput v-else :value="props.value" :label="field.label" :input-key="fieldInputKey" shape="json" @update="emitValue($event)" />
  </template>

  <template v-else>
    <n-input
      v-if="field.type === 'string'"
      :value="strVal"
      :type="stringInputType"
      :autosize="stringInputAutosize"
      size="small"
      :disabled="field.editable === false"
      @update:value="emitValue($event)"
    />

    <n-input
      v-else-if="field.type === 'text'"
      :value="strVal"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 6 }"
      size="small"
      @update:value="emitValue($event)"
    />

    <NumberValueInput
      v-else-if="field.type === 'integer'"
      :value="numVal"
      :input-key="fieldInputKey"
      :clear-action="field.required ? 'required' : 'null'"
      @remove="emit('update', { kind: 'remove' })"
      :min="field.min ?? undefined"
      :max="field.max ?? undefined"
      :step="field.step ?? 1"
      :show-button="false"
      size="small"
      integer
      @update:value="emitValue($event)"
    />

    <NumberValueInput
      v-else-if="field.type === 'float'"
      :value="numVal"
      :input-key="fieldInputKey"
      :clear-action="field.required ? 'required' : 'null'"
      @remove="emit('update', { kind: 'remove' })"
      :min="field.min ?? undefined"
      :max="field.max ?? undefined"
      :step="field.step ?? 0.1"
      :show-button="false"
      size="small"
      @update:value="emitValue($event)"
    />

    <n-switch
      v-else-if="field.type === 'boolean'"
      class="tool-switch field-switch"
      :value="boolVal"
      size="small"
      @update:value="emitValue($event)"
    />

    <n-select
      v-else-if="field.type === 'enum'"
      :value="strVal"
      :options="displayOptions"
      :render-label="renderSelectLabel"
      size="small"
      clearable
      @update:show="handleSelectShowUpdate"
      @update:value="emitValue($event)"
    />

    <ColorPicker
      v-else-if="field.type === 'color-rgb' || field.type === 'color-rgba'"
      :model-value="props.value as JsonValue"
      :channels="field.type === 'color-rgb' ? 'rgb' : 'rgba'"
      :output="field.type === 'color-rgb' ? 'rgb-array' : 'rgba-array'"
      :label="field.label"
      :input-key="fieldInputKey"
      @update:model-value="emitValue($event)"
    />

    <!-- path-image: searchable dropdown + file picker -->
    <div v-else-if="field.type === 'path-image'" class="path-field ui-control-row">
      <n-select
        :value="strVal || null"
        :options="graphicsOptions"
        :render-label="renderGraphicsLabel"
        filterable
        clearable
        tag
        size="small"
        placeholder="搜索或输入图片路径"
        class="path-select"
        @update:show="handleSelectShowUpdate"
        @update:value="emitValue($event ?? '')"
      />
      <n-button
        class="compact-icon-button ui-control-reset"
        size="small"
        quaternary
        title="选择图片文件"
        @click="pickPathFile({ imageFilter: true })"
      >
        <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5h6l2 2h8v12H4z" />
          <path d="M8 14h8M12 10v8" />
        </svg>
      </n-button>
    </div>

    <!-- path: input + file picker (no image dropdown) -->
    <div v-else-if="field.type === 'path'" class="path-field ui-control-row">
      <n-input :value="strVal" size="small" @update:value="emitValue($event)" />
      <n-button class="compact-icon-button ui-control-reset" size="small" quaternary title="选择文件" @click="pickPathFile">
        <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5h6l2 2h8v12H4z" />
          <path d="M8 14h8M12 10v8" />
        </svg>
      </n-button>
    </div>

    <div v-else-if="field.type === 'string-array' || field.type === 'tag-select'" class="ui-layout-row ui-layout-stack ui-layout-stretch">
      <n-select
        :value="field.type === 'tag-select' ? tagSelectVal : arrVal"
        :options="field.type === 'tag-select' ? tagDisplayOptions : listOptions"
        :render-label="renderSelectLabel"
        :render-tag="renderSelectTag"
        multiple
        filterable
        tag
        size="small"
        @update:show="handleSelectShowUpdate"
        @update:value="updateTagSelection"
      />
      <div v-if="customTag !== null" class="ui-control-row">
        <n-input
          ref="customTagInput"
          :value="customTag"
          size="small"
          placeholder="输入自定义值"
          @update:value="customTag = $event"
          @blur="commitCustomTag"
          @keydown.enter.prevent="commitCustomTag"
          @keydown.esc.stop.prevent="customTag = null"
        />
        <n-button size="small" @click="commitCustomTag">添加</n-button>
      </div>
    </div>

    <div
      v-else-if="field.type === 'key-value'"
      class="field-map ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-clip ui-layout-stretch"
      :class="{ 'field-map-reference': isReferenceKeyValue }"
    >
      <div
        v-for="(row, idx) in kvRows"
        :key="row.rowId"
        class="field-map-row ui-layout-grid ui-layout-shrink ui-layout-center ui-layout-stretch"
      >
        <div class="field-map-key-editor ui-layout-row ui-layout-stack ui-layout-shrink ui-layout-stretch">
          <n-select
            :value="row.entry.key"
            :options="kvKeyOptions"
            :render-label="renderSelectLabel"
            filterable
            tag
            size="small"
            class="field-map-key ui-layout-shrink ui-layout-stretch"
            @update:show="handleSelectShowUpdate($event, `kv:${row.rowId}`)"
            @update:value="updateKvKey(idx, $event)"
          />
          <div v-if="customKvKey?.rowId === row.rowId" class="ui-control-row">
            <n-input
              ref="customKvKeyInput"
              :value="customKvKey.text"
              size="small"
              placeholder="输入自定义值"
              @update:value="customKvKey.text = $event"
              @blur="commitCustomKvKey"
              @keydown.enter.prevent="commitCustomKvKey"
              @keydown.esc.stop.prevent="customKvKey = null"
            />
            <n-button size="small" @click="commitCustomKvKey">添加</n-button>
          </div>
        </div>
        <SchemaValueInput
          v-if="field.valueSchema"
          :field="field.valueSchema"
          :value="row.entry.val"
          :field-path="valuePath(row.entry.key, idx)"
          :runtime-context="runtimeContext"
          :input-key="`${fieldInputKey}/${row.rowId}`"
          @update="updateKvValue(idx, $event)"
        />
        <n-input
          v-else
          :value="formatSchemaKeyValueText(row.entry.val)"
          class="field-map-value ui-layout-shrink ui-layout-stretch"
          size="small"
          @update:value="updateKvVal(idx, $event)"
        />
        <n-button class="compact-icon-button ui-control-reset" size="tiny" quaternary title="删除" @click="removeKvEntry(idx)">
          <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </n-button>
      </div>
      <n-button size="tiny" @click="addKvEntry">+ 添加</n-button>
    </div>

    <!-- object (recurse into nested fields) -->
    <div
      v-else-if="field.type === 'object' && field.nested"
      class="nested-object ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-clip"
    >
      <SchemaFieldRow v-for="sub in field.nested" :key="sub.key" :field="sub" :path="`${fieldTitle}.${sub.key}`"
        ><SchemaValueInput
          :field="sub"
          :value="getSubValue(sub.key)"
          :field-path="`${fieldTitle}.${sub.key}`"
          :runtime-context="runtimeContext"
          :input-key="`${fieldInputKey}/${sub.key}`"
          @update="onSubUpdate(sub.key, $event)"
      /></SchemaFieldRow>
    </div>

    <div
      v-else-if="field.type === 'array' && field.item"
      class="field-collection ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-clip ui-layout-stretch"
    >
      <div
        v-for="(_, idx) in genericArrayItems"
        :key="genericRowIds[idx]"
        class="field-collection-item ui-layout-shrink ui-layout-clip ui-layout-stretch ui-control-border"
      >
        <div class="field-collection-header ui-control-row">
          <span class="field-collection-index ui-text-meta ui-text-muted">#{{ idx + 1 }}</span>
          <n-button class="compact-icon-button ui-control-reset" size="tiny" quaternary title="删除" @click="removeGenericArrayItem(idx)">
            <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </n-button>
        </div>
        <SchemaFieldRow :field="field.item" :path="`${fieldTitle}[${idx}]`"
          ><SchemaValueInput
            :field="{ ...field.item, required: true }"
            :value="genericArrayItems[idx]"
            :field-path="`${fieldTitle}[${idx}]`"
            :runtime-context="runtimeContext"
            :input-key="`${fieldInputKey}/${genericRowIds[idx]}`"
            @update="updateGenericArrayItem(idx, $event)"
        /></SchemaFieldRow>
      </div>
      <n-button size="tiny" @click="addGenericArrayItem">+ 添加项</n-button>
    </div>

    <div
      v-else-if="field.type === 'array-of-object' && field.nested"
      class="field-collection ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-clip ui-layout-stretch"
    >
      <div
        v-for="(_, idx) in arrayItems"
        :key="arrayRowIds[idx]"
        class="field-collection-item ui-layout-shrink ui-layout-clip ui-layout-stretch ui-control-border"
      >
        <div class="field-collection-header ui-control-row">
          <span class="field-collection-index ui-text-meta ui-text-muted">#{{ idx + 1 }}</span>
          <n-button class="compact-icon-button ui-control-reset" size="tiny" quaternary title="删除" @click="removeArrayItem(idx)">
            <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </n-button>
        </div>
        <SchemaFieldRow v-for="sub in field.nested" :key="sub.key" :field="sub" :path="`${fieldTitle}[${idx}].${sub.key}`"
          ><SchemaValueInput
            :field="sub"
            :value="getArrayItemValue(idx, sub.key)"
            :field-path="`${fieldTitle}[${idx}].${sub.key}`"
            :runtime-context="runtimeContext"
            :input-key="`${fieldInputKey}/${arrayRowIds[idx]}/${sub.key}`"
            @update="onArrayItemUpdate(idx, sub.key, $event)"
        /></SchemaFieldRow>
      </div>
      <n-button size="tiny" @click="addArrayItem">+ 添加项</n-button>
    </div>

    <JsonValueInput v-else :value="props.value" :label="field.label" :input-key="fieldInputKey" shape="json" @update="emitValue($event)" />
  </template>
</template>

<script setup lang="ts">
import SchemaFieldRow from './SchemaFieldRow.vue';
import { computed, h, nextTick, ref, watch } from 'vue';
import type { InputInst } from 'naive-ui/es/input';
import { NTag } from 'naive-ui/es/tag';
import type { JsonValue, ResourceRef } from '@/shared/types';
import { useSchemaPathPicker } from '@/app/composables/editors/use-schema-path-picker';
import { useSchemaSourceOptions } from '@/app/composables/editors/use-schema-source-options';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FieldSchema } from '@/domain/schema/schema.types';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import {
  appendSchemaKeyValueEntry,
  applySchemaFieldUpdate,
  formatSchemaCommaList,
  formatSchemaKeyValueText,
  parseSchemaCommaList,
  parseSchemaKeyValueText,
  schemaArrayStringValues,
  schemaKeyValueEntries,
  schemaKeyValueOutput,
  schemaJsonInputShape,
  schemaNumberControlValue,
  schemaPathDisplayLabel,
  schemaStringValue,
  schemaTagValues,
  type SchemaKeyValueEntry,
  wrapSchemaTagValues,
} from '@/domain/schema/schema-values';
import {
  fieldSourceCurrentValues,
  includeCurrentSelectOptions,
  schemaEnumSelectOptions,
  selectOptionText,
  type SelectOption,
} from '@/domain/schema/schema-options';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import { useEditorRowIdentities } from '@/app/composables/editors/use-editor-row-identities';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import ResourceOptionThumbnail from '@/app/components/media/ResourceOptionThumbnail.vue';
import { useCoreGraphics } from '@/app/composables/use-core-assets';
import SchemaScalarInput from '@/app/components/schema/SchemaScalarInput.vue';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { registerFieldInput, useFieldInputs } from '@/shared/runtime/field-inputs';
import { isCsvSource } from '@/domain/schema/csv-source-options';
import { useSchemaSelectMedia } from '@/app/composables/use-schema-select-media';

const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  runtimeContext?: SchemaRuntimeContext | null;
  inputKey?: string;
  fieldPath?: string;
}>();

const emit = defineEmits<{
  update: [update: SchemaFieldUpdate];
}>();

function emitValue(value: unknown) {
  emit('update', { kind: 'set', value });
}

const { graphicsPaths, loadGraphics } = useCoreGraphics();
watch(
  () => props.field.type === 'path-image',
  (active) => {
    if (active) loadGraphics();
  },
  { immediate: true },
);

const mode = useInputEditMode();
const plainMode = computed(() => mode.value === 'plain');
const fieldInputs = useFieldInputs();
const fieldInputKey = computed(() => props.inputKey ?? props.field.key);
const fieldTitle = computed(() => props.fieldPath ?? props.field.key);
function valuePath(key: string, index: number): string {
  const base = Array.isArray(props.value) ? `${fieldTitle.value}[${index}]` : fieldTitle.value;
  return `${base}[${JSON.stringify(key)}]`;
}
const { replaceSchemaSelectSprites, releaseSchemaSelectSprites } = useSchemaSelectMedia();

const strVal = computed(() => schemaStringValue(props.value));
const stringTextareaAutosize = { minRows: 1, maxRows: 6 };
const stringInputType = computed(() => (strVal.value.includes('\n') || strVal.value.includes('\r') ? 'textarea' : 'text'));
const stringInputAutosize = computed(() => (stringInputType.value === 'textarea' ? stringTextareaAutosize : undefined));

const numVal = computed(() => schemaNumberControlValue(props.value));

const boolVal = computed(() => props.value === true);

const arrVal = computed(() => schemaArrayStringValues(props.value));

const jsonShape = computed(() => schemaJsonInputShape(props.field));

// tag-select: value is { tags: string[] } or string[]
const tagSelectVal = computed(() => schemaTagValues(props.value));

function wrapTags(tags: string[]): unknown {
  return wrapSchemaTagValues(props.value, tags);
}

function emitPlainStringArray(raw: string) {
  emitValue(parseSchemaCommaList(raw));
}

function emitPlainTagSelect(raw: string) {
  emitValue(wrapSchemaTagValues(props.value, parseSchemaCommaList(raw)));
}

const { sourceOptions } = useSchemaSourceOptions({
  field: () => props.field,
  value: () => props.value,
  runtimeContext: () => props.runtimeContext,
});
const { pickPathFile } = useSchemaPathPicker({
  pathBase: () => props.field.pathBase,
  runtimeContext: () => props.runtimeContext,
  setPath: (path) => emitValue(path),
});
const isReferenceKeyValue = computed(() => props.field.type === 'key-value' && isCsvSource(props.field.source));

// On-demand thumbnails: resolve in batch only on dropdown open or selection change.

interface OptionMediaEntry {
  resource: ResourceRef;
  value: string;
}

function collectOptionMedia(options: SelectOption[]): OptionMediaEntry[] {
  const out: OptionMediaEntry[] = [];
  const walk = (list: SelectOption[]) => {
    for (const option of list) {
      if (option.resourceRef) out.push({ resource: option.resourceRef, value: String(option.value ?? '') });
      if (option.children?.length) walk(option.children);
    }
  };
  walk(options);
  return out;
}

function ensureSelectMedia(id: string) {
  const sessionId = props.runtimeContext?.sessionId;
  if (!sessionId || !isCsvSource(props.field.source)) return;
  void replaceSchemaSelectSprites(sessionId, id, []);
}

function ensureCurrentMedia() {
  const sessionId = props.runtimeContext?.sessionId;
  if (!isCsvSource(props.field.source) || !sessionId) {
    void replaceSchemaSelectSprites(sessionId, 'selected', []);
    return;
  }
  const values = new Set(fieldSourceCurrentValues(props.field, props.value));
  const matched = collectOptionMedia(sourceOptions.value).filter((entry) => values.has(entry.value));
  void replaceSchemaSelectSprites(
    sessionId,
    'selected',
    matched.map((entry) => entry.resource),
  );
}

watch([sourceOptions, () => fieldSourceCurrentValues(props.field, props.value)], () => ensureCurrentMedia(), { immediate: true });

// Render label with optional thumbnail for n-select options.
function renderSelectLabel(option: SelectOption & { label?: string; value?: string }) {
  const label = h('span', { class: 'schema-select-option-label' }, selectOptionText(option));
  if (!option.resourceRef || !props.runtimeContext?.sessionId) return h('span', { title: selectOptionTitle(option) }, [label]);
  return h('span', { class: 'schema-select-option', title: selectOptionTitle(option) }, [
    h(ResourceOptionThumbnail, {
      sessionId: props.runtimeContext.sessionId,
      resource: option.resourceRef,
      label: selectOptionText(option),
      class: 'schema-select-option-thumb',
    }),
    label,
  ]);
}

function renderSelectTag({ option, handleClose }: { option: SelectOption; handleClose: () => void }) {
  return h(
    NTag,
    {
      closable: true,
      internalCloseFocusable: false,
      internalCloseIsButtonTag: false,
      size: 'small',
      onClose: handleClose,
    },
    { default: () => renderSelectLabel(option) },
  );
}

function selectOptionTitle(option: SelectOption & { label?: string; value?: string }): string | undefined {
  const value = option.value ?? '';
  const label = selectOptionText(option);
  return [value, label !== value ? label : '', option.description ?? ''].filter(Boolean).join('\n') || undefined;
}

const enumOptions = computed(() => {
  return schemaEnumSelectOptions(props.field, sourceOptions.value);
});

// Ghost echo: values missing from the catalog (broken refs, manual input) enter the option tree as raw text.
const displayOptions = computed(() => includeCurrentSelectOptions(enumOptions.value, fieldSourceCurrentValues(props.field, props.value)));
const listOptions = computed(() => includeCurrentSelectOptions(sourceOptions.value, arrVal.value));
const tagDisplayOptions = computed(() => includeCurrentSelectOptions(sourceOptions.value, tagSelectVal.value));

const customTag = ref<string | null>(null);
const customTagInput = ref<InputInst | null>(null);
const customKvKey = ref<{ rowId: number; text: string } | null>(null);
const customKvKeyInput = ref<InputInst[]>([]);
function updateTagSelection(values: string[]) {
  const template = sourceOptions.value
    .flatMap((group) => group.children ?? [group])
    .find((option) => option.templateValue !== undefined && values.includes(option.value));
  if (template) {
    customTag.value = template.templateValue!;
    void nextTick(() => customTagInput.value?.focus());
  } else emitValue(props.field.type === 'tag-select' ? wrapTags(values) : values);
}
function commitCustomTag() {
  const value = customTag.value?.trim();
  customTag.value = null;
  if (!value) return;
  const values = [...new Set([...(props.field.type === 'tag-select' ? tagSelectVal.value : arrVal.value), value])];
  emitValue(props.field.type === 'tag-select' ? wrapTags(values) : values);
}
registerFieldInput({
  get key() {
    return fieldInputKey.value + '/custom-tag';
  },
  get label() {
    return props.field.label;
  },
  dirty: computed(() => !!customTag.value?.trim()),
  commit: () => {
    commitCustomTag();
    return null;
  },
  cancel: () => {
    customTag.value = null;
  },
  focus: () => customTagInput.value?.focus(),
});
function commitCustomKvKey() {
  const pending = customKvKey.value;
  const key = pending?.text.trim();
  customKvKey.value = null;
  if (!key || !pending) return;
  const idx = kvRowIds.value.indexOf(pending.rowId);
  const entries = [...kvEntries.value];
  entries[idx] = { ...entries[idx]!, key };
  emitKvUpdate(entries);
}
registerFieldInput({
  get key() {
    return customKvKey.value ? `${fieldInputKey.value}/${customKvKey.value.rowId}/custom-key` : `${fieldInputKey.value}/custom-key`;
  },
  get label() {
    return props.field.label;
  },
  dirty: computed(() => !!customKvKey.value?.text.trim()),
  commit: () => {
    commitCustomKvKey();
    return null;
  },
  cancel: () => {
    customKvKey.value = null;
  },
  focus: () => customKvKeyInput.value.at(-1)?.focus(),
});
watch(
  () => [fieldInputKey.value, props.field.source, props.runtimeContext?.sessionId, props.runtimeContext?.sourceContextKey],
  () => {
    customTag.value = null;
    customKvKey.value = null;
  },
);

const graphicsOptions = computed(() => {
  const options: SelectOption[] = [];
  if (props.field.pathBase === 'mission') return options;
  const seen = new Set<string>();

  // Add core graphics paths
  for (const path of graphicsPaths.value) {
    if (!seen.has(path)) {
      seen.add(path);
      options.push({ label: schemaPathDisplayLabel(path), value: path });
    }
  }

  return options;
});

function renderGraphicsLabel(option: SelectOption & { label?: string; value?: string }) {
  const path = option.value ?? '';
  const filename = schemaPathDisplayLabel(path);
  return h('span', { title: path, class: 'schema-select-option-label' }, filename);
}

// For key-value fields: merge source options with existing keys as candidates
const kvKeyOptions = computed(() => {
  const source = sourceOptions.value;
  return includeCurrentSelectOptions(
    source,
    kvEntries.value.map((entry) => entry.key),
  );
});

function getSubValue(subKey: string): unknown {
  if (props.value && typeof props.value === 'object' && !Array.isArray(props.value)) {
    return (props.value as Record<string, unknown>)[subKey];
  }
  return undefined;
}

function onSubUpdate(subKey: string, update: SchemaFieldUpdate) {
  const current =
    props.value && typeof props.value === 'object' && !Array.isArray(props.value) ? (props.value as import('@/shared/types').RowData) : {};
  emitValue(applySchemaFieldUpdate(current, subKey, update));
}

const arrayItems = computed(() => (Array.isArray(props.value) ? (props.value as Record<string, unknown>[]) : []));
const arrayIdentity = useEditorRowIdentities(() => arrayItems.value);
const arrayRowIds = arrayIdentity.identities;

function getArrayItemValue(idx: number, subKey: string): unknown {
  const item = arrayItems.value[idx];
  return item ? item[subKey] : undefined;
}

function onArrayItemUpdate(idx: number, subKey: string, update: SchemaFieldUpdate) {
  const items = [...arrayItems.value];
  items[idx] = applySchemaFieldUpdate(items[idx] as import('@/shared/types').RowData, subKey, update);
  arrayIdentity.commit(items);
  emitValue(items);
}

function addArrayItem() {
  const items = [...arrayItems.value];
  const newItem: Record<string, unknown> = {};
  if (props.field.nested) {
    for (const sub of props.field.nested) {
      newItem[sub.key] = sub.default ?? null;
    }
  }
  items.push(newItem);
  arrayIdentity.commit(items, { kind: 'insert', index: items.length - 1 });
  emitValue(items);
}

function removeArrayItem(idx: number) {
  fieldInputs?.cancel(`${fieldInputKey.value}/${arrayRowIds.value[idx]}`);
  const items = [...arrayItems.value];
  items.splice(idx, 1);
  arrayIdentity.commit(items, { kind: 'remove', index: idx });
  emitValue(items);
}

const kvEntries = computed<SchemaKeyValueEntry[]>(() => schemaKeyValueEntries(props.value, props.field.format));

const kvIdentity = useEditorRowIdentities(() => kvEntries.value);
const kvRowIds = kvIdentity.identities;

const kvRows = computed(() => kvEntries.value.map((entry, idx) => ({ entry, rowId: kvRowIds.value[idx] ?? idx })));

function emitKvUpdate(entries: SchemaKeyValueEntry[], operation?: { kind: 'insert' | 'remove'; index: number }) {
  const output = schemaKeyValueOutput(entries, props.field.format);
  kvIdentity.commit(schemaKeyValueEntries(output, props.field.format), operation);
  emitValue(output);
}

function updateKvKey(idx: number, newKey: string) {
  const template = sourceOptions.value
    .flatMap((group) => group.children ?? [group])
    .find((option) => option.value === newKey && option.templateValue !== undefined);
  if (template) {
    customKvKey.value = { rowId: kvRowIds.value[idx]!, text: template.templateValue! };
    void nextTick(() => customKvKeyInput.value.at(-1)?.focus());
    return;
  }
  const entries = [...kvEntries.value];
  entries[idx] = { ...entries[idx]!, key: newKey };
  emitKvUpdate(entries);
}

function updateKvVal(idx: number, newVal: string) {
  const entries = [...kvEntries.value];
  entries[idx] = { ...entries[idx]!, val: parseSchemaKeyValueText(newVal) };
  emitKvUpdate(entries);
}

function updateKvValue(idx: number, update: SchemaFieldUpdate) {
  if (update.kind === 'remove') {
    removeKvEntry(idx);
    return;
  }
  const entries = [...kvEntries.value];
  entries[idx] = { ...entries[idx]!, val: update.value };
  emitKvUpdate(entries);
}

function removeKvEntry(idx: number) {
  fieldInputs?.cancel(`${fieldInputKey.value}/${kvRowIds.value[idx]}`);
  void releaseSchemaSelectSprites(`kv:${kvRowIds.value[idx]}`);
  const entries = [...kvEntries.value];
  entries.splice(idx, 1);
  emitKvUpdate(entries, { kind: 'remove', index: idx });
}

function addKvEntry() {
  const output = appendSchemaKeyValueEntry(kvEntries.value, props.field.format);
  kvIdentity.commit(schemaKeyValueEntries(output, props.field.format), { kind: 'insert', index: kvEntries.value.length });
  emitValue(output);
}

const genericArrayItems = computed(() => (Array.isArray(props.value) ? props.value : []));
const genericIdentity = useEditorRowIdentities(() => genericArrayItems.value);
const genericRowIds = genericIdentity.identities;

function updateGenericArrayItem(idx: number, update: SchemaFieldUpdate) {
  if (update.kind === 'remove') {
    removeGenericArrayItem(idx);
    return;
  }
  const items = [...genericArrayItems.value];
  items[idx] = update.value;
  genericIdentity.commit(items);
  emitValue(items);
}

function addGenericArrayItem() {
  const items = [...genericArrayItems.value];
  items.push(props.field.item?.default ?? null);
  genericIdentity.commit(items, { kind: 'insert', index: items.length - 1 });
  emitValue(items);
}

function removeGenericArrayItem(idx: number) {
  fieldInputs?.cancel(`${fieldInputKey.value}/${genericRowIds.value[idx]}`);
  const items = [...genericArrayItems.value];
  items.splice(idx, 1);
  genericIdentity.commit(items, { kind: 'remove', index: idx });
  emitValue(items);
}

function handleSelectShowUpdate(show: boolean, id = 'menu') {
  if (show) ensureSelectMedia(id);
  else void releaseSchemaSelectSprites(id);
}
</script>
