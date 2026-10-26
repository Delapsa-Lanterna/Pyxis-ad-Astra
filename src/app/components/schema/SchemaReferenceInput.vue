<template>
  <SchemaScalarInput v-if="plainMode" :field="field" :value="value" :input-key="inputKey" @update="emit('update', $event)" />
  <n-select
    v-else-if="field.type === 'enum'"
    ref="referenceSelect"
    :show="reference ? referenceOpen : undefined"
    :value="strVal"
    :options="displayOptions"
    :render-label="renderSelectLabel"
    :filterable="Boolean(field.source)"
    size="small"
    :clearable="!field.required"
    :disabled="field.editable === false"
    @update:show="handleSelectShowUpdate"
    @search="$event ? reference?.update($event) : reference?.cancel()"
    @blur="reference?.commit()"
    @keydown.esc="reference?.cancel()"
    @update:value="reference ? (reference.update($event ?? ''), reference.commit()) : emitValue($event ?? '')"
  />
  <div v-else-if="field.type === 'path-image' || field.type === 'path'" class="path-field ui-control-row">
    <n-select
      v-if="field.type === 'path-image'"
      ref="referenceSelect"
      :show="referenceOpen"
      :value="strVal || null"
      :options="graphicsOptions"
      :render-label="renderGraphicsLabel"
      filterable
      clearable
      tag
      size="small"
      placeholder="搜索或输入图片路径"
      class="path-select"
      :disabled="field.editable === false"
      @update:show="handleSelectShowUpdate"
      @search="$event ? reference?.update($event) : reference?.cancel()"
      @blur="reference?.commit()"
      @keydown.esc="reference?.cancel()"
      @update:value="reference && (reference.update($event ?? ''), reference.commit())"
    />
    <SchemaScalarInput v-else :field="field" :value="value" :input-key="inputKey" @update="emit('update', $event)" />
    <n-button
      class="compact-icon-button ui-control-reset"
      size="small"
      quaternary
      title="选择文件"
      @click="pickPathFile({ imageFilter: field.type === 'path-image' })"
    >
      <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19V5h6l2 2h8v12H4z" />
        <path d="M8 14h8M12 10v8" />
      </svg>
    </n-button>
  </div>
  <div v-else class="ui-layout-row ui-layout-stack ui-layout-stretch">
    <n-select
      ref="referenceSelect"
      :show="reference ? referenceOpen : undefined"
      :value="field.type === 'tag-select' ? tagSelectVal : arrVal"
      :options="listOptions"
      :render-label="renderSelectLabel"
      :render-tag="renderSelectTag"
      multiple
      filterable
      :tag="!reference"
      size="small"
      @update:show="handleSelectShowUpdate"
      @search="$event ? reference?.update($event) : reference?.cancel()"
      @blur="reference?.commit()"
      @keydown.esc="reference?.cancel()"
      @update:value="updateTagSelection"
    />
    <div v-if="customTag !== null" class="ui-control-row">
      <SchemaScalarInput
        ref="customTagInput"
        :field="{ key: 'custom-tag', label: field.label, type: 'string' }"
        value=""
        :initial-text="customTag"
        :input-key="inputKey + '/custom-tag'"
        @update="commitCustomTag($event.kind === 'set' ? String($event.value) : '')"
        @cancel="customTag = null"
      />
      <n-button size="small" @click="customTagInput?.commit()">添加</n-button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NTag } from 'naive-ui/es/tag';
import SchemaScalarInput from './SchemaScalarInput.vue';
import ResourceOptionThumbnail from '@/app/components/media/ResourceOptionThumbnail.vue';
import { useSchemaSourceOptions } from '@/app/composables/editors/use-schema-source-options';
import { useSchemaPathPicker } from '@/app/composables/editors/use-schema-path-picker';
import { useSchemaSelectMedia } from '@/app/composables/use-schema-select-media';
import { useImageSourceOptions } from '@/app/composables/editors/use-image-source-options';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { isCsvSource } from '@/domain/schema/csv-source-options';
import { isEntitySource } from '@/domain/schema/schema-sources';
import {
  fieldSourceCurrentValues,
  includeCurrentSelectOptions,
  schemaEnumSelectOptions,
  selectOptionText,
  selectOptionValues,
  type SelectOption,
} from '@/domain/schema/schema-options';
import {
  schemaStringValue,
  schemaArrayStringValues,
  schemaTagValues,
  wrapSchemaTagValues,
  schemaPathDisplayLabel,
  convertSchemaScalarInput,
} from '@/domain/schema/schema-values';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { ResourceRef } from '@/shared/types';
import { useRawFieldInput } from '@/shared/runtime/raw-field-input';
const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  inputKey: string;
  fieldPath?: string;
  runtimeContext?: SchemaRuntimeContext | null;
}>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const mode = useInputEditMode();
const plainMode = computed(() => mode.value === 'plain');
const fieldInputKey = computed(() => props.inputKey);
const strVal = computed(() => schemaStringValue(props.value));
const referenceOpen = ref(false),
  referenceSelect = ref<{ focusInput: () => void } | null>(null);
const reference =
  props.field.type === 'path-image' || (props.field.source && ['enum', 'string-array', 'tag-select'].includes(props.field.type))
    ? useRawFieldInput<string>({
        key: props.inputKey,
        path: props.fieldPath ?? props.field.key,
        label: props.field.label,
        text: () => (['enum', 'path-image'].includes(props.field.type) ? strVal.value : ''),
        convert: (text) => {
          if (!['enum', 'path-image'].includes(props.field.type)) return { kind: 'value', value: text };
          if (text === '') return props.field.required ? { kind: 'error', message: '必填字段不能为空' } : { kind: 'remove' };
          const result = convertSchemaScalarInput(text, props.field);
          return result.kind === 'set' ? { kind: 'value', value: String(result.value) } : result;
        },
        apply: (result) => {
          if (!['enum', 'path-image'].includes(props.field.type) && result.kind === 'value') {
            const values = [...new Set([...(props.field.type === 'tag-select' ? tagSelectVal.value : arrVal.value), result.value])];
            emitValue(props.field.type === 'tag-select' ? wrapTags(values) : values);
          } else emit('update', result.kind === 'remove' ? result : { kind: 'set', value: result.value });
        },
        focus: () => referenceSelect.value?.focusInput(),
        onCancel: () => {
          referenceOpen.value = false;
        },
      })
    : null;
const arrVal = computed(() => schemaArrayStringValues(props.value));
const tagSelectVal = computed(() => schemaTagValues(props.value));
const graphicsOptions = useImageSourceOptions({
  sessionId: () => props.runtimeContext?.sessionId,
  directories: () => (props.field.pathBase === 'mission' && !props.runtimeContext?.missionId ? [] : props.field.imageDirectories),
  missionId: () => (props.field.pathBase === 'mission' ? props.runtimeContext?.missionId : undefined),
  active: () => !plainMode.value && props.field.type === 'path-image' && referenceOpen.value,
});
const { replaceSchemaSelectSprites, releaseSchemaSelectSprites } = useSchemaSelectMedia();
function emitValue(value: unknown) {
  emit('update', { kind: 'set', value });
}
function wrapTags(tags: string[]) {
  return wrapSchemaTagValues(props.value, tags);
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
  if (!sessionId || (!isCsvSource(props.field.source) && !isEntitySource(props.field.source))) return;
  void replaceSchemaSelectSprites(sessionId, id, []);
}

function ensureCurrentMedia() {
  const sessionId = props.runtimeContext?.sessionId;
  if ((!isCsvSource(props.field.source) && !isEntitySource(props.field.source)) || !sessionId) {
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
const enumValues = computed(() => selectOptionValues(enumOptions.value));
const sourceValues = computed(() => selectOptionValues(sourceOptions.value));
const referenceValues = computed(() => [
  ...fieldSourceCurrentValues(props.field, props.value),
  ...(reference?.dirty.value && reference.raw.value ? [reference.raw.value] : []),
]);
const displayOptions = computed(() => includeCurrentSelectOptions(enumOptions.value, referenceValues.value, enumValues.value));
const listOptions = computed(() => includeCurrentSelectOptions(sourceOptions.value, referenceValues.value, sourceValues.value));

const customTag = ref<string | null>(null);
const customTagInput = ref<InstanceType<typeof SchemaScalarInput> | null>(null);
function updateTagSelection(values: string[]) {
  reference?.update('');
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
    reference?.cancel();
  },
);

function renderGraphicsLabel(option: SelectOption & { label?: string; value?: string }) {
  if (option.type === 'group') return option.label;
  const path = option.value ?? '';
  const filename = schemaPathDisplayLabel(path);
  return h('span', { title: path, class: 'schema-select-option-label' }, filename);
}

function handleSelectShowUpdate(show: boolean) {
  referenceOpen.value = show;
  if (show) ensureSelectMedia('menu');
  else void releaseSchemaSelectSprites('menu');
}
</script>
