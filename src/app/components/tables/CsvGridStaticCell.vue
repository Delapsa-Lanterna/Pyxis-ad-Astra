<template>
  <template v-if="mode === 'plain'">
    <span class="csv-cell-value ui-text-truncate ui-layout-shrink">{{ rawValue }}</span>
  </template>
  <template v-else-if="isListControl">
    <span
      v-for="value in listValues"
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
    <svg class="csv-cell-caret ui-control-icon ui-text-muted" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
  </template>
  <template v-else-if="showsPickerCaret">
    <span class="csv-cell-value ui-text-truncate ui-layout-shrink">{{ displayValue }}</span>
    <svg class="csv-cell-caret ui-control-icon ui-text-muted" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
  </template>
  <template v-else>
    <span class="csv-cell-value ui-text-truncate ui-layout-shrink">{{ rawValue }}</span>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { cell } from '@/shared/lib/starsector';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import { sourceValue } from '@/domain/tables/csv-source-options';
import {
  csvColumnControl,
  csvControlUsesPicker,
  csvListValues,
  isCsvListControl,
  isCsvReferenceControl,
} from '@/domain/tables/csv-column-schema';
import { useCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { useCsvGridMedia } from '@/app/composables/tables/use-csv-grid-media';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';

const props = defineProps<{
  column: CsvGridColumn;
  row: CsvRowRecord;
  sourceIndex: CsvSourceIndex;
}>();

const rawValue = computed(() => cell(props.row.data[props.column.key]));
const mode = useInputEditMode();
const context = useCsvTableInputs();
const media = useCsvGridMedia();
const control = computed(() => csvColumnControl(props.column.schema));
const isListControl = computed(() => isCsvListControl(control.value));
const isReferenceControl = computed(() => isCsvReferenceControl(control.value));
const listValues = computed(() => csvListValues(rawValue.value));
const referenceMatch = computed(() => sourceValue(props.sourceIndex, props.column.schema?.source, rawValue.value));
const showsPickerCaret = computed(() => csvControlUsesPicker(control.value) && !isListControl.value && !isReferenceControl.value);
const displayValue = computed(() => referenceMatch.value?.option.label ?? rawValue.value);

const sprite = computed(() => {
  const match = referenceMatch.value;
  if (!match?.option.resourceRef) return undefined;
  return media.url(match.option.resourceRef);
});

function listValueDescription(value: string): string | undefined {
  return sourceValue(props.sourceIndex, props.column.schema?.source, value)?.option.description ?? undefined;
}
</script>
