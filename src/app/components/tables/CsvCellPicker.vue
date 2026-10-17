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
      placeholder="搜索选项"
    />
    <button class="csv-cell-picker-action ui-button ui-text-small ui-layout-stretch ui-text-normal" type="button" @click="toggleCustomMode">
      自定义值
    </button>
    <input
      v-if="customMode"
      :value="customText"
      class="csv-cell-picker-custom ui-input ui-text-normal ui-text-small ui-layout-stretch ui-content-surface-muted"
      placeholder="输入自定义值"
      @input="updateCustom"
      @keydown.enter.prevent="submitCustom"
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
      <template v-for="group in filteredGroups" :key="group.key">
        <div v-if="group.label" class="csv-cell-picker-group ui-text-muted">{{ group.label }}</div>
        <button
          class="ui-button ui-text-normal ui-text-small ui-layout-row ui-layout-center ui-layout-stretch"
          v-for="option in group.options"
          :key="option.value"
          :ref="visible.mediaRef(option.value, option.resourceRef)"
          :class="['csv-cell-picker-option', { selected: selectedValues.has(option.value) }]"
          :aria-pressed="multiple ? selectedValues.has(option.value) : undefined"
          :title="option.description ?? undefined"
          type="button"
          @click="selectOption(option.value)"
        >
          <svg v-if="multiple" class="csv-cell-picker-check ui-control-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path v-if="selectedValues.has(option.value)" d="m3 8 3 3 7-6" />
          </svg>
          <ResourceThumbnail
            v-if="option.resourceRef"
            class="csv-cell-picker-thumb"
            :session-id="sessionId"
            :resource="option.resourceRef"
            :url="visible.mediaSrc(option.resourceRef)"
            :active="visible.mediaVisible(option.value)"
            :label="option.label"
            :width="18"
            :height="18"
          />
          <span class="csv-cell-picker-label ui-text-truncate ui-layout-shrink">{{ option.label }}</span>
          <span v-if="option.value !== option.label" class="csv-cell-picker-value ui-text-truncate ui-layout-shrink ui-text-muted">{{
            option.value
          }}</span>
        </button>
      </template>
    </div>
    <button
      v-if="multiple"
      class="csv-cell-picker-action ui-button ui-text-small ui-layout-stretch ui-text-normal"
      type="button"
      @click="$emit('commit', captureValues())"
    >
      确认选择
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { groupSelectOptions, type SelectOption } from '@/domain/schema/schema-options';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
import { useCsvFloatingPanel } from '@/app/composables/tables/use-csv-floating-panel';

const props = defineProps<{
  anchor: { height: number; left: number; top: number; width: number };
  multiple: boolean;
  sessionId: string;
  options: SelectOption[];
  values: string[];
}>();

const emit = defineEmits<{
  cancel: [];
  commit: [values: string[]];
  'pending-custom': [dirty: boolean];
  update: [values: string[]];
}>();

const visible = useVisibleResourceMedia({ sessionId: () => props.sessionId, surface: 'CSV 选项', failureLabel: '读取选项图片失败' });

const query = ref('');
const customMode = ref(false);
const customText = ref('');
const searchRef = useTemplateRef<HTMLInputElement>('searchRef');
const selectedValues = computed(() => new Set(props.values));

// Mirrors the .csv-cell-picker max-height in tables.css.
const PICKER_MAX_HEIGHT = 320;

const pickerStyle = useCsvFloatingPanel(() => props.anchor, PICKER_MAX_HEIGHT);
const groups = computed(() => groupSelectOptions(props.options));
const filteredGroups = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return groups.value;
  return groups.value
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.options.length > 0);
});

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  nextTick(() => searchRef.value?.focus());
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown, true);
});

function clearValue() {
  emit('commit', ['']);
}

function selectOption(value: string) {
  if (!props.multiple) {
    emit('commit', [value]);
    return;
  }
  const next = new Set(props.values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  emit('update', [...next]);
}

function submitCustom() {
  const values = captureValues();
  if (props.multiple) emit('update', values);
  else emit('commit', values);
}

function captureValues(): string[] {
  const trimmed = customText.value.trim();
  cancelCustom();
  if (!trimmed) return props.values;
  if (props.multiple) {
    const next = new Set(props.values);
    next.add(trimmed);
    return [...next];
  }
  return [trimmed];
}

function updateCustom(event: Event) {
  customText.value = (event.target as HTMLInputElement).value;
  emit('pending-custom', customText.value.trim() !== '');
}

function toggleCustomMode() {
  if (customMode.value) cancelCustom();
  customMode.value = !customMode.value;
}

function cancelCustom() {
  customText.value = '';
  emit('pending-custom', false);
}

defineExpose({ captureValues, cancelCustom });

function handleDocumentMouseDown(event: MouseEvent) {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.('.csv-cell-picker')) return;
  emit('commit', captureValues());
}
</script>
