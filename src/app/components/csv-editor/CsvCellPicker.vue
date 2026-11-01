<template>
  <div
    ref="pickerRef"
    class="csv-cell-picker ui-layout-row ui-layout-stack ui-layout-clip ui-control-border ui-content-surface"
    :style="pickerStyle"
    tabindex="-1"
    @mousedown.stop
    @keydown.esc="cancelSelection"
  >
    <input
      ref="searchRef"
      v-model="inputText"
      :data-csv-raw="editingRaw ? '' : undefined"
      :data-csv-candidate="activeOption ? '' : undefined"
      class="csv-cell-picker-search ui-input ui-text-normal ui-text-small ui-layout-stretch ui-content-surface-muted"
      placeholder="搜索或输入值，回车确认"
      @keydown.enter="submitQuery"
      @compositionstart="activeValue = null"
    />
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
          :active-value="activeOption?.value"
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
      @click="confirmSelection"
    >
      确认选择
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { groupSelectOptions, type FlatSelectOption, type SelectOption } from '@/domain/schema/schema-options';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import CsvCellPickerGroup from './CsvCellPickerGroup.vue';
import { useCsvFloatingPanel } from '@/app/composables/csv-editor/use-csv-floating-panel';
import { focusCsvCellText, type CsvCellEdit } from '@/app/composables/csv-editor/csv-cell-edit';
import { csvListValues } from '@/domain/csv-editor/csv-column-schema';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';

const props = defineProps<{
  anchor: { height: number; left: number; top: number; width: number };
  multiple: boolean;
  sessionId: string;
  options: SelectOption[];
  imagePaths?: boolean;
  values: string[];
  edit?: CsvCellEdit;
  rawValue?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  commit: [values: string[]];
  update: [values: string[]];
  'update-raw': [value: string];
  'commit-raw': [];
}>();

const visible = useVisibleResourceMedia({
  sessionId: () => props.sessionId,
  surface: 'CSV 选项',
  failureLabel: '读取选项图片失败',
  thumbnailSize: 18,
});

const collapsedGroups = ref(new Set<string | number>());
const query = ref('');
const activeValue = ref<string | null>(null);
const pickerRef = useTemplateRef<HTMLDivElement>('pickerRef');
const editingRaw = computed(() => props.edit?.kind === 'raw');
const inputText = computed({
  get: () => (editingRaw.value ? props.rawValue! : query.value),
  set: (value: string) => {
    activeValue.value = null;
    if (editingRaw.value) emit('update-raw', value);
    else query.value = value;
  },
});
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
  const text = inputText.value.trim().toLowerCase();
  const needles = editingRaw.value && props.multiple ? csvListValues(text) : text ? [text] : [];
  if (!needles.length) return groups.value;
  return groups.value
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => needles.some((needle) => catalog.value.search.get(option)!.includes(needle))),
    }))
    .filter((group) => group.options.length > 0);
});
const navigableOptions = computed(() =>
  filteredGroups.value.flatMap((group) => (collapsedGroups.value.has(group.key) ? [] : group.options)),
);
const activeOption = computed(() => navigableOptions.value.find((option) => option.value === activeValue.value));
watch(navigableOptions, () => {
  if (!activeOption.value) activeValue.value = null;
});
watch(activeOption, async (option) => {
  if (!option) return;
  await nextTick();
  pickerRef.value?.querySelector('.csv-cell-picker-option.active')?.scrollIntoView({ block: 'nearest' });
});
useWindowShortcuts({
  priority: (event) => {
    if (event.target !== searchRef.value || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
    const options = navigableOptions.value;
    if (!options.length) return true;
    const current = options.findIndex((option) => option.value === (activeOption.value?.value ?? props.values[0]));
    const next =
      current < 0
        ? event.key === 'ArrowDown'
          ? 0
          : options.length - 1
        : Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    activeValue.value = options[next]!.value;
    return true;
  },
});

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  void nextTick(focusSearch);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown, true);
});

function focusSearch() {
  const input = searchRef.value;
  if (!input) return;
  if (props.edit?.kind === 'raw') focusCsvCellText(input, props.edit.offsetX);
  else input.focus({ preventScroll: true });
}

function cancelSelection(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  emit('cancel');
}

function selectOption(option: FlatSelectOption) {
  if (option.templateValue !== undefined) {
    const prefix = editingRaw.value && props.multiple && props.rawValue ? props.rawValue + ', ' : '';
    inputText.value = prefix + option.templateValue;
    void nextTick(() => {
      focusSearch();
      searchRef.value?.setSelectionRange(prefix.length, inputText.value.length);
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
  if (event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  if (activeOption.value) {
    selectOption(activeOption.value);
    return;
  }
  if (editingRaw.value) {
    emit('commit-raw');
    return;
  }
  const value = query.value.trim();
  if (!value) return;
  const option = catalog.value.exact.get(value);
  selectOption(option ?? { label: value, value });
}

defineExpose({ reset: () => (query.value = ''), focus: focusSearch });

function confirmSelection() {
  if (editingRaw.value) emit('commit-raw');
  else emit('commit', props.values);
}

function handleDocumentMouseDown(event: MouseEvent) {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.('.csv-grid-cell')) return;
  if (target?.closest?.('.csv-cell-picker')) return;
  confirmSelection();
}
</script>
