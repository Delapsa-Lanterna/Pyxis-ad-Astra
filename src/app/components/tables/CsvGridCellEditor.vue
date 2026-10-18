<template>
  <div
    class="csv-cell-editor"
    :class="{ 'csv-cell-editor-picker': !usesNativeInput && !isTextControl }"
    @mousedown.stop
    @click.stop
    @keydown.esc.stop.prevent="cancelAndClose"
  >
    <input
      v-if="usesNativeInput"
      ref="inputRef"
      class="csv-cell-input ui-input ui-text-normal ui-layout-shrink ui-layout-clip ui-layout-stretch ui-control-reset"
      :value="raw"
      @blur="handleNativeBlur"
      @input="handleNativeInput"
      @keydown.enter.prevent="commitAndClose"
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
      <svg class="csv-cell-caret ui-control-icon ui-text-muted" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      <Teleport :to="floating?.overlay.value ?? 'body'" :disabled="!floating?.overlay.value"
        ><CsvCellPicker
          ref="pickerRef"
          :key="inputKey"
          v-if="pickerAnchor"
          :anchor="pickerAnchor"
          :multiple="isListControl"
          :options="pickerOptions"
          :session-id="context.target.sessionId"
          :values="pickerValues"
          @cancel="cancelAndClose"
          @commit="handlePickerCommit"
          @pending-custom="customDirty = $event"
          @update="handlePickerUpdate"
      /></Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useCsvFloatingViewport, type CsvFloatingAnchor } from '@/app/composables/tables/use-csv-floating-panel';
import { cell } from '@/shared/lib/starsector';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import { includeCurrentValue, includeCurrentValues, sourceOptions, sourceValue, sourceValueSet } from '@/domain/tables/csv-source-options';
import {
  csvBooleanOptions,
  csvColumnControl,
  csvControlUsesNativeInput,
  csvListValues,
  formatCsvListValue,
  isCsvListControl,
  isCsvReferenceControl,
} from '@/domain/tables/csv-column-schema';
import { useCsvGridMedia } from '@/app/composables/tables/use-csv-grid-media';
import { useCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { registerFieldInput } from '@/shared/runtime/field-inputs';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import CsvCellPicker from '@/app/components/tables/CsvCellPicker.vue';
import CsvCellTextEditor from '@/app/components/tables/CsvCellTextEditor.vue';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';

const props = defineProps<{
  anchorElement: HTMLElement | null;
  initialAnchor?: CsvFloatingAnchor | null;
  column: CsvGridColumn;
  row: CsvRowRecord;
  sourceIndex: CsvSourceIndex;
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

const raw = ref(cell(props.row.data[props.column.key]));
const baseline = ref(raw.value);
const customDirty = ref(false);
const pickerRef = ref<InstanceType<typeof CsvCellPicker> | null>(null);
const dirty = computed(() => raw.value !== baseline.value || customDirty.value);
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
  return csvControlUsesNativeInput(control.value);
});
const isListControl = computed(() => isCsvListControl(control.value));
const isReferenceControl = computed(() => isCsvReferenceControl(control.value));
const listValue = computed(() => csvListValues(raw.value));
const pickerOptions = computed(() => {
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
      customDirty.value = false;
      inputKey.value++;
    }
  },
  { flush: 'post' },
);

function focusActive() {
  if (usesNativeInput.value) {
    inputRef.value?.focus({ preventScroll: true });
    inputRef.value?.select();
    return;
  }
  updateAnchor();
}

function updateAnchor() {
  if (usesNativeInput.value) return;
  const rect = props.anchorElement?.getBoundingClientRect();
  if (rect) pickerAnchor.value = { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
}
const anchorObserver = new ResizeObserver(updateAnchor);
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

function update(value: string) {
  raw.value = value;
}

function commit(): string | null {
  if (pickerRef.value) handlePickerUpdate(pickerRef.value.captureValues());
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
  customDirty.value = false;
  pickerRef.value?.cancelCustom();
}

async function focus() {
  await focusActive();
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
  focus: () => {
    focusFieldInput(inputRef.value);
    return focus();
  },
  cancel,
});

function listValueDescription(value: string): string | undefined {
  return sourceValue(props.sourceIndex, props.column.schema?.source, value)?.option.description ?? undefined;
}

defineExpose({ focus });
</script>
