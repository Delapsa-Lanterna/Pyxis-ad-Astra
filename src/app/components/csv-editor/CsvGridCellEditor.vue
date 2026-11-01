<template>
  <div
    class="csv-cell-editor"
    :class="{ 'csv-cell-editor-picker': !usesNativeInput && !isTextControl }"
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @keydown.esc="handleEscape"
  >
    <input
      v-if="usesNativeInput"
      ref="inputRef"
      class="csv-cell-input ui-input ui-text-normal ui-layout-shrink ui-layout-clip ui-layout-stretch ui-control-reset"
      :value="raw"
      @blur="handleNativeBlur"
      @input="handleNativeInput"
      @keydown.enter="handleEnter"
    />
    <template v-else-if="isTextControl">
      <span class="csv-cell-value ui-text-truncate ui-layout-shrink">{{ displayValue }}</span>
      <Teleport :to="floating?.overlay.value ?? 'body'" :disabled="!floating?.overlay.value"
        ><CsvCellTextEditor
          ref="textEditorRef"
          :key="inputKey"
          v-if="pickerAnchor"
          :anchor="pickerAnchor"
          :value="raw"
          :offset-x="edit?.kind === 'raw' ? edit.offsetX : undefined"
          @update="update"
          @cancel="cancelAndClose"
          @commit="commitAndClose"
      /></Teleport>
    </template>
    <template v-else>
      <template v-if="isListControl">
        <span
          v-for="value in listValue"
          :key="value"
          class="csv-cell-tag ui-text-truncate ui-text-note ui-text-normal ui-control-border"
          :title="listValueDescription(value)"
          >{{ value }}</span
        >
      </template>
      <template v-else-if="isReferenceControl">
        <ResourceThumbnail
          v-if="referenceMatch?.option.resourceRef"
          class="csv-cell-thumb"
          :session-id="context.target.sessionId"
          :resource="referenceMatch.option.resourceRef"
          :url="sprite ?? ''"
          :label="displayValue"
          :width="16"
          :height="16"
        />
        <span class="csv-cell-value ui-text-truncate ui-layout-shrink">{{ displayValue }}</span>
      </template>
      <template v-else>
        <span class="csv-cell-value ui-text-truncate ui-layout-shrink">{{ displayValue }}</span>
      </template>
      <Teleport :to="floating?.overlay.value ?? 'body'" :disabled="!floating?.overlay.value"
        ><CsvCellPicker
          ref="pickerRef"
          :key="inputKey"
          v-if="pickerAnchor"
          :anchor="pickerAnchor"
          :multiple="isListControl"
          :options="pickerOptions"
          :image-paths="control === 'path-image'"
          :session-id="context.target.sessionId"
          :values="pickerValues"
          :edit="edit"
          :raw-value="raw"
          @cancel="cancelAndClose"
          @commit="handlePickerCommit"
          @update="handlePickerUpdate"
          @update-raw="update"
          @commit-raw="commitAndClose"
      /></Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useLayoutFrame } from '@/shared/runtime/use-layout-frame';
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useCsvFloatingViewport, type CsvFloatingAnchor } from '@/app/composables/csv-editor/use-csv-floating-panel';
import { cell } from '@/shared/lib/starsector';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/csv-editor/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/schema/csv-source-options';
import { includeCurrentValue, includeCurrentValues, sourceOptions, sourceValue, sourceValueSet } from '@/domain/schema/csv-source-options';
import {
  csvBooleanOptions,
  csvColumnControl,
  csvControlUsesNativeInput,
  csvListValues,
  formatCsvListValue,
  isCsvListControl,
  isCsvReferenceControl,
} from '@/domain/csv-editor/csv-column-schema';
import { useCsvGridMedia } from '@/app/composables/csv-editor/use-csv-grid-media';
import { useCsvTableInputs } from '@/app/composables/csv-editor/use-csv-table-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { registerFieldInput } from '@/shared/runtime/field-inputs';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import CsvCellPicker from '@/app/components/csv-editor/CsvCellPicker.vue';
import CsvCellTextEditor from '@/app/components/csv-editor/CsvCellTextEditor.vue';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
import { useImageSourceOptions } from '@/app/composables/editors/use-image-source-options';
import { focusCsvCellText, type CsvCellEdit } from '@/app/composables/csv-editor/csv-cell-edit';

const props = defineProps<{
  anchorElement: HTMLElement | null;
  initialAnchor?: CsvFloatingAnchor | null;
  column: CsvGridColumn;
  row: CsvRowRecord;
  sourceIndex: CsvSourceIndex;
  edit?: CsvCellEdit;
}>();

const emit = defineEmits<{
  close: [];
}>();

const mode = useInputEditMode();
const context = useCsvTableInputs();
const media = useCsvGridMedia();
const floating = useCsvFloatingViewport();
const inputRef = useTemplateRef<HTMLInputElement>('inputRef');
const textEditorRef = ref<InstanceType<typeof CsvCellTextEditor> | null>(null);
const pickerAnchor = shallowRef<CsvFloatingAnchor | null>(props.initialAnchor ?? null);

const baseline = ref(cell(props.row.data[props.column.key]));
const raw = ref(props.edit?.kind === 'raw' ? (props.edit.text ?? baseline.value) : baseline.value);
const pickerRef = ref<InstanceType<typeof CsvCellPicker> | null>(null);
const dirty = computed(() => raw.value !== baseline.value);
const inputKey = ref(0);

const rawValue = computed(() => cell(props.row.data[props.column.key]));
watch(rawValue, (value) => {
  if (!dirty.value) raw.value = baseline.value = value;
});
const control = computed(() => csvColumnControl(props.column.schema));
const isTextControl = computed(() => control.value === 'text');
const usesNativeInput = computed(() => {
  if (isTextControl.value) return false;
  if (mode.value === 'plain') return true;
  if (control.value === 'path-image') return false;
  return csvControlUsesNativeInput(control.value);
});
const isListControl = computed(() => isCsvListControl(control.value));
const isReferenceControl = computed(() => isCsvReferenceControl(control.value));
const listValue = computed(() => csvListValues(raw.value));
const imageOptions = useImageSourceOptions({
  sessionId: () => context.target.sessionId,
  directories: () => props.column.schema?.imageDirectories,
  active: () => !usesNativeInput.value && mode.value !== 'plain' && control.value === 'path-image',
});
const pickerOptions = computed(() => {
  if (control.value === 'path-image') return imageOptions.value;
  if (control.value === 'boolean') return csvBooleanOptions();
  if (control.value === 'enum') return props.column.enumOptions;
  const options = sourceOptions(props.sourceIndex, props.column.schema?.source);
  const valueSet = sourceValueSet(props.sourceIndex, props.column.schema?.source);
  if (isListControl.value) return includeCurrentValues(options, valueSet, listValue.value);
  return includeCurrentValue(options, valueSet, rawValue.value);
});
const pickerValues = computed(() => (isListControl.value ? listValue.value : raw.value ? [raw.value] : []));
const referenceMatch = computed(() => sourceValue(props.sourceIndex, props.column.schema?.source, rawValue.value));
const displayValue = computed(() => referenceMatch.value?.option.label ?? rawValue.value);

const sprite = computed(() => {
  const match = referenceMatch.value;
  if (!match?.option.resourceRef) return undefined;
  return media.url(match.option.resourceRef);
});

watch(
  () => [props.row, props.row.rowKey, props.column.key],
  ([row, rowKey, column], previous) => {
    const [previousRow, previousRowKey, previousColumn] = previous ?? [];
    const sameInput = column === previousColumn && (row === previousRow || rowKey === previousRowKey || dirty.value);
    if (!sameInput) {
      raw.value = cell(props.row.data[props.column.key]);
      baseline.value = raw.value;
      inputKey.value++;
    }
  },
  { flush: 'post' },
);

function focusActive() {
  if (usesNativeInput.value) {
    if (inputRef.value) focusCsvCellText(inputRef.value, props.edit?.kind === 'raw' ? props.edit.offsetX : undefined);
    return;
  }
  updateAnchor();
}

function updateAnchor() {
  if (usesNativeInput.value) return;
  const rect = props.anchorElement?.getBoundingClientRect();
  const previous = pickerAnchor.value;
  if (
    rect &&
    (!previous ||
      rect.height !== previous.height ||
      rect.left !== previous.left ||
      rect.top !== previous.top ||
      rect.width !== previous.width)
  )
    pickerAnchor.value = { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
}
const anchorObserver = new ResizeObserver(useLayoutFrame(updateAnchor));
onMounted(() => {
  if (props.anchorElement && !usesNativeInput.value) anchorObserver.observe(props.anchorElement);
  if (usesNativeInput.value || !pickerAnchor.value) focusActive();
});
watch(
  () => props.initialAnchor,
  (anchor) => {
    pickerAnchor.value = anchor ?? null;
  },
);
watch(
  [() => props.anchorElement, usesNativeInput],
  ([element, native], [previous, previousNative]) => {
    if (previous && !previousNative) anchorObserver.unobserve(previous);
    if (element && !native) anchorObserver.observe(element);
    focusActive();
  },
  { flush: 'post' },
);
window.addEventListener('scroll', updateAnchor, true);
window.addEventListener('resize', updateAnchor);
onScopeDispose(() => {
  anchorObserver.disconnect();
  window.removeEventListener('scroll', updateAnchor, true);
  window.removeEventListener('resize', updateAnchor);
});

function handleNativeInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  update(target?.value ?? '');
}

function handleEnter(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  commitAndClose();
}

function handleEscape(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  cancelAndClose();
}

function update(value: string) {
  raw.value = value;
}

function commit(): string | null {
  commitValue();
  return null;
}

function commitValue() {
  if (raw.value !== baseline.value) {
    context.update({ ...context.target, rowKey: props.row.rowKey, column: props.column.key }, raw.value);
    baseline.value = raw.value;
  }
}

function commitAndClose() {
  commit();
  emit('close');
}

function handleNativeBlur() {
  if (!props.anchorElement || props.anchorElement.contains(inputRef.value)) commitAndClose();
}

function cancelAndClose() {
  cancel();
  emit('close');
}

function handlePickerUpdate(values: string[]) {
  raw.value = isListControl.value ? formatCsvListValue(values) : (values[0] ?? '');
}

function handlePickerCommit(values: string[]) {
  handlePickerUpdate(values);
  commitValue();
  emit('close');
}

function cancel() {
  raw.value = rawValue.value;
  baseline.value = raw.value;
  pickerRef.value?.reset();
}

async function focus() {
  focusActive();
  await nextTick();
  textEditorRef.value?.focus();
  pickerRef.value?.focus();
}

registerFieldInput({
  get key() {
    return JSON.stringify([props.row.rowKey, props.column.key]);
  },
  get label() {
    return `${context.target.table} / ${props.row.rowKey} / ${props.column.key}`;
  },
  dirty,
  commit,
  focus: async () => {
    await focusFieldInput(inputRef.value);
    await focus();
  },
  cancel,
});

function listValueDescription(value: string): string | undefined {
  return sourceValue(props.sourceIndex, props.column.schema?.source, value)?.option.description ?? undefined;
}

defineExpose({
  focus,
  capture: () => {
    const text = raw.value;
    return {
      text,
      current: () => raw.value === text,
      accept: () => {
        baseline.value = text;
      },
    };
  },
});
</script>
