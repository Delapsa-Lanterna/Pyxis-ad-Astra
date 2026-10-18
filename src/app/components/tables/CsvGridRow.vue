<template>
  <div
    class="csv-grid-row csv-grid-record"
    role="row"
    :data-row-key="row.rowKey"
    :class="{ selected }"
    :style="{ top: (activity.index + 1) * 24 + 'px', display: activity.hidden ? 'none' : undefined }"
    :aria-rowindex="activity.index + 2"
    @mousedown.prevent
    @click="handleClick"
  >
    <div class="csv-grid-cell csv-row-handle-cell" role="rowheader" :title="reorderDisabledReason || '拖动调整行序'">
      <button
        class="csv-row-handle ui-control-reset"
        type="button"
        :disabled="Boolean(reorderDisabledReason)"
        aria-label="拖动调整行序"
        @pointerdown.prevent.stop="$emit('start-row-drag', row.rowKey, $event)"
        @click.stop="$emit('select-row', row.rowKey)"
      >
        <svg class="csv-row-handle-icon" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M3.2 2a.8.8 0 1 0 1.6 0 .8.8 0 1 0-1.6 0m4 0a.8.8 0 1 0 1.6 0 .8.8 0 1 0-1.6 0m-4 4a.8.8 0 1 0 1.6 0 .8.8 0 1 0-1.6 0m4 0a.8.8 0 1 0 1.6 0 .8.8 0 1 0-1.6 0m-4 4a.8.8 0 1 0 1.6 0 .8.8 0 1 0-1.6 0m4 0a.8.8 0 1 0 1.6 0 .8.8 0 1 0-1.6 0"
          />
        </svg>
      </button>
    </div>
    <div
      v-for="(column, index) in columns"
      :key="column.key"
      class="csv-grid-cell"
      role="gridcell"
      :class="[column.className, { dirty: isDirty(row.rowKey, column.key) }]"
      :data-column-key="column.key"
    >
      <div
        class="csv-cell-frame ui-text-body ui-text-normal ui-layout-row ui-layout-center ui-layout-clip ui-layout-stretch ui-content-surface-muted"
        :class="[
          'csv-cell-frame-' + (mode === 'plain' ? 'text' : cells[index]!.control),
          { 'csv-cell-frame-simple': mode === 'plain' || cells[index]!.simple },
        ]"
      >
        <span v-if="mode === 'plain' || cells[index]!.simple" class="csv-cell-value">{{
          mode === 'plain' ? cell(row.data[column.key]) : cells[index]!.display
        }}</span>
        <template v-else-if="cells[index]!.list">
          <span
            v-for="tag in cells[index]!.tags"
            :key="tag.value"
            class="csv-cell-tag ui-text-truncate ui-text-note ui-text-normal ui-control-border"
            :title="tag.description"
            >{{ tag.value }}</span
          >
        </template>
        <template v-else>
          <ResourceThumbnail
            v-if="cells[index]!.resource"
            class="csv-cell-thumb"
            :session-id="context.target.sessionId"
            :resource="cells[index]!.resource!"
            :url="media.url(cells[index]!.resource!) ?? ''"
            :active="activity.active"
            :label="cells[index]!.display"
            :width="16"
            :height="16"
          />
          <span class="csv-cell-value ui-text-truncate ui-layout-shrink">{{ cells[index]!.display }}</span>
          <svg v-if="cells[index]!.caret" class="csv-cell-caret ui-control-icon ui-text-muted" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </template>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { CsvRowRecord } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import { sourceValue } from '@/domain/tables/csv-source-options';
import { csvColumnControl, csvControlUsesPicker, csvListValues, isCsvListControl } from '@/domain/tables/csv-column-schema';
import { cell } from '@/shared/lib/starsector';
import { useCsvTableInputs } from '@/app/composables/tables/use-csv-table-inputs';
import { useCsvGridMedia } from '@/app/composables/tables/use-csv-grid-media';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
const props = defineProps<{
  row: CsvRowRecord;
  activity: Readonly<{ active: boolean; index: number; hidden: boolean }>;
  columns: CsvGridColumn[];
  sourceIndex: CsvSourceIndex;
  selected: boolean;
  isDirty: (rowKey: string, column: string) => boolean;
  reorderDisabledReason?: string;
}>();
const emit = defineEmits<{
  'start-row-drag': [key: string, event: PointerEvent];
  'activate-cell': [row: CsvRowRecord, column: CsvGridColumn, event: MouseEvent];
  'select-row': [key: string];
}>();
function handleClick(event: MouseEvent) {
  const cell = (event.target as Element).closest<HTMLElement>('[data-column-key]');
  if (cell)
    emit(
      'activate-cell',
      props.row,
      props.columns.find((column) => column.key === cell.dataset.columnKey)!,
      event,
    );
  else emit('select-row', props.row.rowKey);
}
const context = useCsvTableInputs(),
  media = useCsvGridMedia(),
  mode = useInputEditMode();
const cells = computed(() =>
  props.columns.map((column) => {
    const raw = cell(props.row.data[column.key]);
    const control = csvColumnControl(column.schema);
    const match = sourceValue(props.sourceIndex, column.schema?.source, raw);
    const list = isCsvListControl(control);
    const caret = !list && csvControlUsesPicker(control);
    return {
      control,
      list,
      simple: !list && !caret && !match?.option.resourceRef,
      display: match?.option.label ?? raw,
      resource: match?.option.resourceRef,
      caret,
      tags: list
        ? csvListValues(raw).map((value) => ({
            value,
            description: sourceValue(props.sourceIndex, column.schema?.source, value)?.option.description ?? undefined,
          }))
        : undefined,
    };
  }),
);
</script>
