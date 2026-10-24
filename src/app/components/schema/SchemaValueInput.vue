<template>
  <SchemaValueInput
    v-if="field.variants"
    :field="variant"
    :value="value"
    :runtime-context="runtimeContext"
    :input-key="fieldInputKey"
    :field-path="fieldPath"
    @update="emit('update', $event)"
  />
  <SchemaScalarInput
    v-else-if="field.numberFormat === 'starsector' && typeof value === 'string'"
    :field="field"
    :value="value"
    :input-key="fieldInputKey"
    @update="emit('update', $event)"
  />
  <template v-else-if="plainMode && !groupEntries">
    <n-input
      v-if="field.type === 'string' || field.type === 'text'"
      :value="strVal"
      type="textarea"
      :autosize="field.type === 'text' ? { minRows: 2, maxRows: 6 } : stringTextareaAutosize"
      size="small"
      :disabled="field.editable === false"
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
      v-if="field.type === 'string' || field.type === 'text'"
      :value="strVal"
      :type="field.type === 'text' ? 'textarea' : stringInputType"
      :autosize="field.type === 'text' ? { minRows: 2, maxRows: 6 } : stringInputAutosize"
      size="small"
      :disabled="field.editable === false"
      @update:value="emitValue($event)"
    />

    <NumberValueInput
      v-else-if="field.type === 'integer' || field.type === 'float'"
      :value="numVal"
      :input-key="fieldInputKey"
      :clear-action="field.required ? 'required' : 'null'"
      @remove="emit('update', { kind: 'remove' })"
      :min="field.min ?? undefined"
      :max="field.max ?? undefined"
      :step="field.step ?? (field.type === 'integer' ? 1 : 0.1)"
      :show-button="false"
      size="small"
      :integer="field.type === 'integer'"
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
      :filterable="Boolean(field.source)"
      :tag="isConfigSource(field.source)"
      size="small"
      :clearable="!field.required"
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
        <SchemaScalarInput
          ref="customTagInput"
          :field="{ key: 'custom-tag', label: field.label, type: 'string' }"
          value=""
          :initial-text="customTag"
          :input-key="fieldInputKey + '/custom-tag'"
          @update="commitCustomTag($event.kind === 'set' ? String($event.value) : '')"
          @cancel="customTag = null"
        />
        <n-button size="small" @click="customTagInput?.commit()">添加</n-button>
      </div>
    </div>

    <component
      :is="groupEntries ? EditorCollapse : 'div'"
      v-else-if="field.type === 'key-value' || (field.type === 'object' && (!field.nested || groupEntries))"
      class="field-map ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-clip ui-layout-stretch"
      v-bind="groupEntries ? { expandedNames: expandedGroups, 'onUpdate:expandedNames': updateExpandedGroups } : {}"
    >
      <component
        :is="groupEntries ? NCollapseItem : 'div'"
        v-for="group in kvGroups"
        :key="group.id"
        :name="group.id"
        :title="group.title"
        :class="groupEntries ? 'schema-section' : undefined"
      >
        <template v-if="group.entry" #header>
          <span v-if="group.entry.fixed">{{ group.entry.fixed.label }}</span>
          <div v-else class="field-map-key-editor ui-control-row" @click.stop @keydown.stop>
            <SchemaScalarInput
              :field="keyField(group.entry.idx)"
              :value="group.entry.entry.key"
              :input-key="`${fieldInputKey}/${group.entry.rowId}/key`"
              :bordered="false"
              @update="updateKvKey(group.entry.idx, String($event.kind === 'set' ? $event.value : ''))"
            />
          </div>
        </template>
        <template v-if="group.entry" #header-extra>
          <div class="section-header-meta ui-control-row" @click.stop>
            <n-button
              class="compact-icon-button ui-control-reset"
              size="tiny"
              quaternary
              title="删除分组"
              @click.stop="removeKvEntry(group.entry.idx)"
            >
              <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </n-button>
          </div>
        </template>
        <div class="field-map ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-stretch">
          <n-button
            v-if="group.field && !groupRows(group.id).length"
            size="tiny"
            @click="
              addKvEntry({ ...group.field, default: appendSchemaKeyValueEntry([], undefined, group.field.valueSchema) }, group.field.key)
            "
            >添加内容</n-button
          >
          <FieldRow v-for="row in groupRows(group.id)" :key="row.rowId" :layout="row.collection ? 'group' : 'row'">
            <template #label>
              <div
                v-if="!groupEntries || group.id === '__extra'"
                class="field-map-key-editor ui-layout-row ui-layout-shrink ui-layout-stretch"
                :class="row.collection ? 'field-collection-header ui-control-row' : 'ui-layout-stack'"
              >
                <span v-if="row.fixed">{{ row.fixed.label }}</span>
                <n-select
                  v-else-if="field.source"
                  :value="row.entry.key"
                  :options="kvKeyOptions"
                  :render-label="renderSelectLabel"
                  filterable
                  tag
                  size="small"
                  class="field-map-key ui-layout-shrink ui-layout-stretch"
                  @update:show="handleSelectShowUpdate($event, `kv:${row.rowId}`)"
                  @update:value="updateKvKey(row.idx, $event)"
                />
                <SchemaScalarInput
                  v-if="!row.fixed && (!field.source || customKvKey?.rowId === row.rowId)"
                  :key="customKvKey && customKvKey.rowId === row.rowId ? 'custom' : 'name'"
                  :field="keyField(row.idx)"
                  :value="row.entry.key"
                  :initial-text="customKvKey && customKvKey.rowId === row.rowId ? customKvKey.text : undefined"
                  :input-key="`${fieldInputKey}/${row.rowId}/key`"
                  @update="updateKvKey(row.idx, String($event.kind === 'set' ? $event.value : ''))"
                  @cancel="customKvKey = null"
                />
                <n-button
                  v-if="row.collection"
                  class="compact-icon-button ui-control-reset"
                  size="tiny"
                  quaternary
                  title="删除分组"
                  @click="removeKvEntry(row.idx)"
                >
                  <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </n-button>
              </div>
            </template>
            <SchemaValueInput
              v-if="row.field"
              :field="row.field"
              :value="row.entry.val"
              :field-path="valuePath(row.entry.key, row.idx)"
              :runtime-context="runtimeContext"
              :input-key="`${fieldInputKey}/${row.rowId}`"
              @update="updateKvValue(row.idx, $event)"
            />
            <JsonValueInput
              v-else
              :value="row.entry.val"
              :label="row.entry.key"
              :input-key="`${fieldInputKey}/${row.rowId}`"
              shape="json"
              @update="updateKvValue(row.idx, { kind: 'set', value: $event })"
            />
            <n-button
              v-if="!row.collection && (!groupEntries || group.id === '__extra')"
              class="compact-icon-button ui-control-reset"
              size="tiny"
              quaternary
              title="删除"
              @click="removeKvEntry(row.idx)"
            >
              <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </n-button>
          </FieldRow>
        </div>
      </component>
      <template v-if="entrySchema?.variants">
        <n-button v-for="choice in entrySchema.variants" :key="choice.label" size="tiny" @click="addKvEntry(choice)"
          >+ {{ choice.label }}</n-button
        >
      </template>
      <n-button v-else size="tiny" @click="addKvEntry()">+ 添加</n-button>
    </component>

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
      <SchemaFieldRow
        v-if="field.additionalFields && Object.keys(additionalValue).length"
        :field="field.additionalFields"
        :path="fieldTitle"
      >
        <SchemaValueInput
          :field="{ ...field.additionalFields, reservedKeys: [...(field.additionalFields.reservedKeys ?? []), ...nestedKeys] }"
          :value="additionalValue"
          :runtime-context="runtimeContext"
          :input-key="fieldInputKey + '/additional'"
          :field-path="fieldTitle"
          @update="updateAdditional($event.kind === 'set' ? ($event.value as RowData) : {})"
        />
      </SchemaFieldRow>
    </div>

    <div v-else-if="arrayItem" class="field-collection ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-clip ui-layout-stretch">
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
        <component :is="field.type === 'array-of-object' ? 'div' : SchemaFieldRow" :field="arrayItem" :path="`${fieldTitle}[${idx}]`"
          ><SchemaValueInput
            :field="{ ...arrayItem, required: true }"
            :value="genericArrayItems[idx]"
            :field-path="`${fieldTitle}[${idx}]`"
            :runtime-context="runtimeContext"
            :input-key="`${fieldInputKey}/${genericRowIds[idx]}`"
            @update="updateGenericArrayItem(idx, $event)"
        /></component>
      </div>
      <n-button size="tiny" @click="addGenericArrayItem">+ 添加项</n-button>
    </div>

    <JsonValueInput v-else :value="props.value" :label="field.label" :input-key="fieldInputKey" shape="json" @update="emitValue($event)" />
  </template>
</template>

<script setup lang="ts">
import SchemaFieldRow from './SchemaFieldRow.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import { NCollapseItem } from 'naive-ui/es/collapse';
import { computed, h, ref, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { AppError } from '@/shared/lib/errors';
import { NTag } from 'naive-ui/es/tag';
import type { JsonValue, ResourceRef, RowData } from '@/shared/types';
import { useSchemaPathPicker } from '@/app/composables/editors/use-schema-path-picker';
import { useSchemaSourceOptions } from '@/app/composables/editors/use-schema-source-options';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FieldSchema } from '@/domain/schema/schema.types';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import {
  appendSchemaKeyValueEntry,
  applySchemaFieldUpdate,
  formatSchemaCommaList,
  parseSchemaCommaList,
  schemaArrayStringValues,
  schemaKeyValueEntries,
  schemaKeyValueOutput,
  schemaJsonInputShape,
  schemaNumberControlValue,
  schemaPathDisplayLabel,
  schemaStringValue,
  schemaFieldVariant,
  convertSchemaScalarInput,
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
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { isCsvSource } from '@/domain/schema/csv-source-options';
import { isConfigSource } from '@/domain/schema/schema-sources';
import { useSchemaSelectMedia } from '@/app/composables/use-schema-select-media';

const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  runtimeContext?: SchemaRuntimeContext | null;
  inputKey?: string;
  fieldPath?: string;
  groupEntries?: boolean;
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
const feedback = useAppFeedback();
const plainMode = computed(() => mode.value === 'plain');
const fieldInputs = useFieldInputs();
const fieldInputKey = computed(() => props.inputKey ?? props.field.key);
const fieldTitle = computed(() => props.fieldPath ?? props.field.key);
const variant = computed(() => schemaFieldVariant(props.field, props.value));
const nestedKeys = computed(() => (props.field.nested ?? []).map((field) => field.key));
const additionalValue = computed<RowData>(() =>
  Object.fromEntries(Object.entries((props.value as RowData) ?? {}).filter(([key]) => !nestedKeys.value.includes(key))),
);
function updateAdditional(value: RowData) {
  const current = (props.value as RowData) ?? {};
  emitValue({
    ...Object.fromEntries(nestedKeys.value.filter((key) => Object.hasOwn(current, key)).map((key) => [key, current[key]])),
    ...value,
  });
}
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
const customTagInput = ref<InstanceType<typeof SchemaScalarInput> | null>(null);
const customKvKey = ref<{ rowId: number; text: string } | null>(null);
function updateTagSelection(values: string[]) {
  const template = sourceOptions.value
    .flatMap((group) => group.children ?? [group])
    .find((option) => option.templateValue !== undefined && values.includes(option.value));
  if (template) {
    customTag.value = template.templateValue!;
  } else emitValue(props.field.type === 'tag-select' ? wrapTags(values) : values);
}
function commitCustomTag(raw: string) {
  const value = raw.trim();
  customTag.value = null;
  if (!value) return;
  const values = [...new Set([...(props.field.type === 'tag-select' ? tagSelectVal.value : arrVal.value), value])];
  emitValue(props.field.type === 'tag-select' ? wrapTags(values) : values);
}
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

const kvEntries = computed<SchemaKeyValueEntry[]>(() => schemaKeyValueEntries(props.value, props.field.format));
const kvIdentity = useEditorRowIdentities(() => kvEntries.value);
const kvRowIds = kvIdentity.identities;
const entrySchema = computed(
  () =>
    props.field.valueSchema ?? (props.field.additionalFields?.type === 'key-value' ? props.field.additionalFields.valueSchema : undefined),
);
const kvRows = computed(() =>
  kvEntries.value.map((entry, idx) => {
    const fixed = props.groupEntries && props.field.nested?.find((field) => field.key === entry.key);
    const object = entry.val !== null && typeof entry.val === 'object' && !Array.isArray(entry.val);
    const field: FieldSchema | undefined =
      fixed || entrySchema.value || (props.groupEntries && object ? { key: entry.key, label: entry.key, type: 'object' } : undefined);
    return {
      entry,
      idx,
      rowId: kvRowIds.value[idx]!,
      field,
      fixed,
      collection: field
        ? ['object', 'array', 'array-of-object', 'key-value'].includes(field.type)
        : typeof entry.val === 'object' && entry.val !== null,
    };
  }),
);
const kvGroups = computed(() => {
  if (!props.groupEntries) return [{ id: 'entries', title: '', field: undefined, entry: undefined, rows: kvRows.value }];
  const fixed = (props.field.nested ?? []).map((field) => {
    const entry = kvRows.value.find((row) => row.entry.key === field.key);
    return { id: 'fixed:' + field.key, title: field.label, field, entry, rows: entry ? [entry] : [] };
  });
  const objects = kvRows.value.filter(
    (row) => !row.fixed && row.entry.val !== null && typeof row.entry.val === 'object' && !Array.isArray(row.entry.val),
  );
  const other = kvRows.value.filter((row) => !row.fixed && !objects.includes(row));
  return [
    ...fixed,
    ...objects.map((row) => ({ id: String(row.rowId), title: row.entry.key, field: undefined, entry: row, rows: [row] })),
    ...(other.length ? [{ id: '__extra', title: '额外字段', field: undefined, entry: undefined, rows: other }] : []),
  ];
});
const collapsedGroups = ref<string[]>([]);
function groupRows(id: string) {
  return kvGroups.value.find((group) => group.id === id)!.rows;
}
const expandedGroups = computed(() => kvGroups.value.map((group) => group.id).filter((id) => !collapsedGroups.value.includes(id)));
function updateExpandedGroups(names: (string | number)[]) {
  collapsedGroups.value = kvGroups.value.map((group) => group.id).filter((id) => !names.includes(id));
}
function keyField(idx: number): FieldSchema {
  return {
    key: 'key',
    label: '名称',
    type: 'string',
    required: true,
    reservedKeys: [
      ...(props.field.reservedKeys ?? []),
      ...nestedKeys.value,
      ...(!props.field.format ? kvEntries.value.filter((_, index) => index !== idx).map((entry) => entry.key) : []),
    ],
  };
}

function emitKvUpdate(entries: SchemaKeyValueEntry[], operation?: { kind: 'insert' | 'remove'; index: number }) {
  const output = schemaKeyValueOutput(entries, props.field.format);
  kvIdentity.commit(schemaKeyValueEntries(output, props.field.format), operation);
  emitValue(output);
}

function updateKvKey(idx: number, newKey: string) {
  const converted = convertSchemaScalarInput(newKey, keyField(idx));
  if (converted.kind === 'error') {
    feedback.error(new AppError(converted.message, { code: 'schema.key_duplicate' }));
    return;
  }
  const template = sourceOptions.value
    .flatMap((group) => group.children ?? [group])
    .find((option) => option.value === newKey && option.templateValue !== undefined);
  if (template) {
    customKvKey.value = { rowId: kvRowIds.value[idx]!, text: template.templateValue! };
    return;
  }
  customKvKey.value = null;
  const entries = [...kvEntries.value];
  entries[idx] = { ...entries[idx]!, key: newKey };
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

function addKvEntry(choice = entrySchema.value, key?: string) {
  choice ??= props.groupEntries ? { key: 'group', label: '分组', type: 'object', default: {} } : undefined;
  const output = appendSchemaKeyValueEntry(kvEntries.value, props.field.format, choice);
  const entries = schemaKeyValueEntries(output, props.field.format);
  if (key !== undefined) entries[entries.length - 1] = { key, val: choice?.default ?? {} };
  emitKvUpdate(entries, { kind: 'insert', index: kvEntries.value.length });
}

const genericArrayItems = computed(() => (Array.isArray(props.value) ? props.value : []));
const arrayItem = computed<FieldSchema | undefined>(() =>
  props.field.type === 'array-of-object' && props.field.nested
    ? {
        key: 'item',
        label: props.field.label,
        type: 'object',
        nested: props.field.nested,
        default: Object.fromEntries(props.field.nested.map((field) => [field.key, field.default ?? null])),
      }
    : props.field.item,
);
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
  items.push(arrayItem.value?.default ?? null);
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
