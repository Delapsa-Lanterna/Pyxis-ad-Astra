<template>
  <div
    class="csv-cell-picker ui-layout-row ui-layout-stack ui-layout-clip ui-control-border ui-content-surface"
    :style="pickerStyle"
    tabindex="-1"
    @mousedown.stop
    @keydown.esc.stop.prevent="$emit('cancel')"
  >
    <input
      ref="searchRef"
      v-model="query"
      class="csv-cell-picker-search ui-input ui-text-normal ui-text-small ui-layout-stretch ui-content-surface-muted"
      placeholder="搜索或输入新值，回车确认"
      @keydown.enter="submitQuery"
    />
    <button
      v-if="!multiple && selectedValues.size > 0"
      class="csv-cell-picker-clear ui-button ui-text-small ui-layout-stretch"
      type="button"
      @click="clearValue"
    >
      清除当前值
    </button>
    <div :ref="visible.setMediaRoot" class="csv-cell-picker-list">
      <NCollapse
        arrow-placement="right"
        display-directive="show"
        :expanded-names="groups.filter((group) => !collapsedGroups.has(group.key)).map((group) => group.key)"
        @item-header-click="
          ({ name, expanded }: { name: string | number; expanded: boolean }) =>
            expanded ? collapsedGroups.delete(name) : collapsedGroups.add(name)
        "
      >
        <CsvCellPickerGroup
          v-for="group in filteredGroups"
          :key="group.key"
          :group="group"
          :media="visible"
          :selected="selectedValues"
          :multiple="multiple"
          :session-id="sessionId"
          :image-paths="imagePaths"
          @select="selectOption"
        />
      </NCollapse>
    </div>
    <button
      v-if="multiple"
      class="csv-cell-picker-action ui-button ui-text-small ui-layout-stretch ui-text-normal"
      type="button"
      @click="$emit('commit', values)"
    >
      确认选择
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { groupSelectOptions, type FlatSelectOption, type SelectOption } from '@/domain/schema/schema-options';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import CsvCellPickerGroup from './CsvCellPickerGroup.vue';
import { useCsvFloatingPanel } from '@/app/composables/csv-editor/use-csv-floating-panel';

const props = defineProps<{
  anchor: { height: number; left: number; top: number; width: number };
  multiple: boolean;
  sessionId: string;
  options: SelectOption[];
  imagePaths?: boolean;
  values: string[];
}>();

const emit = defineEmits<{
  cancel: [];
  commit: [values: string[]];
  update: [values: string[]];
}>();

const visible = useVisibleResourceMedia({
  sessionId: () => props.sessionId,
  surface: 'CSV 选项',
  failureLabel: '读取选项图片失败',
  thumbnailSize: 18,
});

const collapsedGroups = ref(new Set<string | number>());
const query = ref('');
const searchRef = useTemplateRef<HTMLInputElement>('searchRef');
const selectedValues = computed(() => new Set(props.values));

// Mirrors the .csv-cell-picker max-height in tables.css.
const PICKER_MAX_HEIGHT = 320;

const pickerStyle = useCsvFloatingPanel(() => props.anchor, PICKER_MAX_HEIGHT);
const groups = computed(() => groupSelectOptions(props.options));
const catalog = computed(() => {
  const search = new Map<FlatSelectOption, string>();
  const exact = new Map<string, FlatSelectOption>();
  for (const group of groups.value)
    for (const option of group.options) {
      search.set(option, (option.label + '\u0000' + option.value).toLowerCase());
      for (const text of [option.value, option.label]) if (!exact.has(text)) exact.set(text, option);
    }
  return { search, exact };
});
const filteredGroups = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return groups.value;
  return groups.value
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => catalog.value.search.get(option)!.includes(needle)),
    }))
    .filter((group) => group.options.length > 0);
});

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  void nextTick(focusSearch);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown, true);
});

function focusSearch() {
  searchRef.value?.focus({ preventScroll: true });
}

function clearValue() {
  emit('commit', ['']);
}

function selectOption(option: FlatSelectOption) {
  if (option.templateValue !== undefined) {
    query.value = option.templateValue;
    void nextTick(() => {
      focusSearch();
      searchRef.value?.select();
    });
    return;
  }
  query.value = '';
  const value = option.value;
  if (!props.multiple) {
    emit('commit', [value]);
    return;
  }
  const next = new Set(props.values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  emit('update', [...next]);
}

function submitQuery(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.preventDefault();
  const value = query.value.trim();
  if (!value) return;
  const option = catalog.value.exact.get(value);
  selectOption(option ?? { label: value, value });
}

defineExpose({ reset: () => (query.value = ''), focus: focusSearch });

function handleDocumentMouseDown(event: MouseEvent) {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.('.csv-grid-cell')) return;
  if (target?.closest?.('.csv-cell-picker')) return;
  emit('commit', props.values);
}
</script>
