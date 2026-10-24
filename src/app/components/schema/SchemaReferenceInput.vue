<template>
  <SchemaScalarInput v-if="plainMode" :field="field" :value="value" :input-key="inputKey" @update="emit('update', $event)" />
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
    @update:value="emitValue($event ?? '')"
  />
  <div v-else-if="field.type === 'path-image' || field.type === 'path'" class="path-field ui-control-row">
    <n-select
      v-if="field.type === 'path-image'"
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
import { useCoreGraphics } from '@/app/composables/use-core-assets';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { isCsvSource } from '@/domain/schema/csv-source-options';
import { isConfigSource } from '@/domain/schema/schema-sources';
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
} from '@/domain/schema/schema-values';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { ResourceRef } from '@/shared/types';
const props = defineProps<{ field: FieldSchema; value: unknown; inputKey: string; runtimeContext?: SchemaRuntimeContext | null }>();
const emit = defineEmits<{ update: [update: SchemaFieldUpdate] }>();
const mode = useInputEditMode();
const plainMode = computed(() => mode.value === 'plain');
const fieldInputKey = computed(() => props.inputKey);
const strVal = computed(() => schemaStringValue(props.value));
const arrVal = computed(() => schemaArrayStringValues(props.value));
const tagSelectVal = computed(() => schemaTagValues(props.value));
const { graphicsPaths, loadGraphics } = useCoreGraphics();
watch(
  () => props.field.type === 'path-image',
  (active) => {
    if (active) loadGraphics();
  },
  { immediate: true },
);
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
const enumValues = computed(() => selectOptionValues(enumOptions.value));
const sourceValues = computed(() => selectOptionValues(sourceOptions.value));
const displayOptions = computed(() =>
  includeCurrentSelectOptions(enumOptions.value, fieldSourceCurrentValues(props.field, props.value), enumValues.value),
);
const listOptions = computed(() => includeCurrentSelectOptions(sourceOptions.value, arrVal.value, sourceValues.value));
const tagDisplayOptions = computed(() => includeCurrentSelectOptions(sourceOptions.value, tagSelectVal.value, sourceValues.value));

const customTag = ref<string | null>(null);
const customTagInput = ref<InstanceType<typeof SchemaScalarInput> | null>(null);
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

function handleSelectShowUpdate(show: boolean) {
  if (show) ensureSelectMedia('menu');
  else void releaseSchemaSelectSprites('menu');
}
</script>
