<template>
  <div
    ref="surface"
    class="variant-hullmod-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="调整插件"
    tabindex="-1"
    @keydown.esc.stop.prevent="cancel"
    @keydown="navigate"
    @focusout="blurDetails"
  >
    <section
      ref="table"
      class="variant-hullmod-table"
      :style="{ '--hullmod-columns': columnWidths.map((value) => value + 'px').join(' ') }"
    >
      <header class="variant-hullmod-columns">
        <button
          v-for="column in columns"
          :key="column.key"
          :aria-label="column.label + '排序'"
          :aria-sort="sortKey === column.key ? (ascending ? 'ascending' : 'descending') : 'none'"
          @click="sort(column.key)"
        >
          <ImmersiveText :text="column.label" font="heading" ink-aligned outlined /><ImmersiveResourceIcon
            v-if="uiImages.sortIcon"
            :source="uiImages.sortIcon"
            color="#aadeff"
            :size="15"
            label="排序"
            :class="{ ascending: sortKey === column.key && ascending }"
          />
        </button>
      </header>
      <div ref="list" class="variant-hullmod-list" :style="{ height: listHeight + 'px' }" @scroll="scroll">
        <ImmersiveText v-if="loading" text="正在读取插件目录" />
        <div v-else-if="errorText"><ImmersiveText :text="errorText" block /><n-button @click="load">重试</n-button></div>
        <template v-else>
          <div :style="{ height: viewport.beforeHeight.value + 'px' }" aria-hidden="true" />
          <button
            v-for="entry in viewport.visibleItems.value"
            :key="entry.id"
            :data-entry-id="entry.id"
            class="variant-hullmod-row"
            :class="{
              installed: Boolean(installed(entry.id)),
              unavailable: installed(entry.id)?.category === 'builtin' || Boolean(state(entry).diagnostic),
            }"
            :aria-disabled="installed(entry.id)?.category === 'builtin'"
            :title="state(entry).label + (state(entry).diagnostic ? '\n' + state(entry).diagnostic : '')"
            @mouseenter="showDetails(entry)"
            @mouseleave="leaveRow"
            @focus="showDetails(entry)"
            @click="choose(entry.id)"
          >
            <span class="variant-hullmod-name" :title="entry.label" :style="{ color: state(entry).color }"
              ><span :ref="visible.mediaRef('icon/' + entry.id, entry.resourceRefs.icon)" class="variant-hullmod-icon"
                ><ResourceThumbnail
                  v-if="entry.resourceRefs.icon"
                  :session-id="root.sessionId"
                  :resource="entry.resourceRefs.icon"
                  :url="visible.mediaSrc(entry.resourceRefs.icon)"
                  :active="visible.mediaVisible('icon/' + entry.id)"
                  :label="entry.label"
                  :width="32"
                  :height="32" /><span
                  v-else
                  class="variant-hullmod-image-placeholder"
                  :title="entry.resourceRefs.icon ? '正在读取图片' : '插件图片来源缺失'" /></span
              ><ImmersiveText :text="abbreviate(entry.label, columnWidths[0]! - 56)" ink-aligned outlined
            /></span>
            <span class="variant-hullmod-design" :style="{ color: designTypeColor(reference, hullmodDesign(entry)) }"
              ><ImmersiveText :text="abbreviate(hullmodDesign(entry), columnWidths[1]! - 6)" ink-aligned outlined
            /></span>
            <span :style="{ color: state(entry).costColor }"><ImmersiveText :text="state(entry).costText" ink-aligned outlined /></span>
            <span :ref="visible.mediaRef('status/' + entry.id, statusRef(entry))"
              ><ImmersiveResourceIcon
                v-if="visible.mediaSrc(statusRef(entry))"
                :source="visible.mediaSrc(statusRef(entry))"
                :color="state(entry).iconColor"
                :size="20"
                :label="state(entry).label" /><ImmersiveText
                v-else-if="installed(entry.id)"
                :text="state(entry).label"
                font="caption"
                ink-aligned
            /></span>
          </button>
          <div :style="{ height: viewport.afterHeight.value + 'px' }" aria-hidden="true" />
          <ImmersiveText v-if="!filtered.length" text="没有匹配插件" block />
        </template>
      </div>
      <div ref="filters" class="variant-hullmod-filters">
        <ImmersiveFilterGroup
          v-model="designs"
          :options="designOptions"
          label="全部设计类型"
          :total="availableEntries.length"
        /><ImmersiveFilterGroup v-model="tags" :options="tagOptions" label="全部类型" :total="availableEntries.length" />
      </div>
      <div ref="auxiliary" class="variant-hullmod-auxiliary">
        <n-input v-model:value="search" placeholder="搜索 ID／名称" clearable />
        <details @toggle="measure">
          <summary class="immersive-disclosure-summary"><ImmersiveText text="来源与安装选项" font="caption" ink-aligned /></summary>
          <div class="variant-hullmod-extra">
            <n-select v-model:value="origin" :options="origins" /><n-select v-model:value="category" :options="categories" /><n-input
              v-model:value="manualId"
              placeholder="手动填写 ID"
              @keydown.enter.stop.prevent="manual"
            /><n-button @click="manual">提交 ID</n-button>
          </div>
        </details>
      </div>
    </section>
    <slot name="stats" :close="cancel" />
    <div v-if="selected" ref="tooltip" class="variant-hullmod-tooltip" :style="tooltipPosition" @mouseleave="leaveDetails">
      <VariantHullmodDetails :key="selected.id" :entry="selected" :reference="reference" :images="uiImages" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onScopeDispose } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import type { VariantProjection } from '@/domain/immersive/variant/variant-panel';
import type { HullmodCategory } from '@/domain/immersive/variant/variant-actions';
import {
  hullmodDesign,
  visibleHullmod,
  hullmodColumns,
  hullmodListHeight,
  hullmodFilterOptions,
  hullmodMatches,
  sortHullmods,
  hullmodRowState,
  type HullmodSort,
} from '@/domain/immersive/variant/variant-hullmods';
import { designTypeColor } from '@/domain/immersive/design-type';
import { useVariantCatalog } from '@/app/composables/immersive-editor/variant/use-variant-catalog';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useCsvGridViewport } from '@/app/composables/tables/use-csv-grid-viewport';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { warningNotice } from '@/shared/lib/errors';
import { useFontMeasurement } from '@/app/composables/use-original-fonts';
import { textGraphemes } from '@/domain/fonts/text-layout';
import { immersiveFontIds } from '@/domain/immersive/font-roles';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersiveFilterGroup from '../ImmersiveFilterGroup.vue';
import ImmersiveResourceIcon from '../ImmersiveResourceIcon.vue';
import VariantHullmodDetails from './VariantHullmodDetails.vue';
const props = defineProps<{ root: JointEditRoot; variant: VariantProjection }>();
const emit = defineEmits<{
  select: [id: string, category: HullmodCategory];
  'manual-commit': [id: string, category: HullmodCategory];
  close: [];
}>();
const surface = ref<HTMLElement | null>(null),
  table = ref<HTMLElement | null>(null),
  list = ref<HTMLElement | null>(null),
  auxiliary = ref<HTMLElement | null>(null),
  tooltip = ref<HTMLElement | null>(null);
const filters = ref<HTMLElement | null>(null),
  listHeight = ref(506);
const width = ref(867),
  search = ref(''),
  origin = ref('all'),
  category = ref<HullmodCategory>('normal'),
  manualId = ref(''),
  designs = ref<string[] | null>(null),
  tags = ref<string[] | null>(null),
  hovered = ref('');
const sortKey = ref<HullmodSort>('cost'),
  ascending = ref(false),
  tooltipPosition = ref({ left: '0px', top: '0px' });
const { entries, snapshot, loading, errorText, load } = useVariantCatalog(
  () => props.root,
  () => 'hullmods',
);
const reference = computed(() => ({ referenceSettings: snapshot.value?.referenceSettings ?? { resources: {}, values: {}, versions: [] } }));
const availableEntries = computed(() => entries.value.filter(visibleHullmod));
const designOptions = computed(() => hullmodFilterOptions(availableEntries.value, 'design')),
  tagOptions = computed(() => hullmodFilterOptions(availableEntries.value, 'tags'));
const installed = (id: string) => props.variant.mods.find((mod) => mod.id === id);
const state = (entry: import('@/shared/types').JointVariantEntry) =>
  hullmodRowState(entry, installed(entry.id), String(props.variant.spec.hullSize), props.variant.opTotal - props.variant.opUsed);
const columnWidths = computed(() => hullmodColumns(width.value));
const columns: Array<{ key: HullmodSort; label: string }> = [
  { key: 'name', label: '插件' },
  { key: 'design', label: '设计类型' },
  { key: 'cost', label: 'OP' },
  { key: 'installed', label: '已安装' },
];
const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return sortHullmods(
    availableEntries.value.filter(
      (entry) =>
        (origin.value === 'all' || entry.source.source === origin.value) &&
        (!needle || [entry.id, entry.label].some((value) => value.toLowerCase().includes(needle))) &&
        hullmodMatches(entry, designs.value, tags.value),
    ),
    sortKey.value,
    ascending.value,
    String(props.variant.spec.hullSize),
    installed,
  );
});
const viewport = useCsvGridViewport(filtered, { editingIndex: ref(null), rowHeight: 36, overscan: 2 });
const visible = useVisibleResourceMedia({
  sessionId: () => props.root.sessionId,
  surface: '插件选择列表',
  failureLabel: '插件图片读取失败',
});
const statusRef = (entry: import('@/shared/types').JointVariantEntry) => reference.value.referenceSettings.resources[state(entry).iconKey];
const feedback = useAppFeedback(),
  inputs = useFieldInputs()!,
  prefix = 'variant-hullmod/manual';
const media = useResourceMediaRegistry({
  surface: '插件选择控件',
  onError: feedback.error,
  onFailures: (items) =>
    feedback.warning(warningNotice('插件控件资源缺失：' + items.length, 'resource.read_failed', 'Hullmod selector controls')),
});
const uiKeys = [
  'sortIcon',
  'ui_border1b_e',
  'ui_border1b_e_bot',
  'ui_border1b_e_top',
  'ui_border1b_w',
  'ui_border1b_w_bot',
  'ui_border1b_w_top',
];
const uiImages = computed(() =>
  Object.fromEntries(
    uiKeys.map((key) => [key, media.dataUrl(props.root.sessionId, reference.value.referenceSettings.resources[key]) ?? '']),
  ),
);
watch(
  reference,
  (value) => {
    void media.replaceCollection(
      props.root.sessionId,
      'hullmod-ui',
      uiKeys.flatMap((key) => (value.referenceSettings.resources[key] ? [value.referenceSettings.resources[key]!] : [])),
    );
  },
  { immediate: true },
);
const selected = computed(() => (hovered.value ? availableEntries.value.find((entry) => entry.id === hovered.value) : undefined));
const measureText = useFontMeasurement(immersiveFontIds.body);
function abbreviate(text: string, maxWidth: number) {
  if (measureText([{ text }]) <= maxWidth) return text;
  let result = '';
  for (const character of textGraphemes(text)) {
    if (measureText([{ text: result + character + '…' }]) > maxWidth) break;
    result += character;
  }
  return result + '…';
}
function measure() {
  width.value = table.value!.clientWidth;
  listHeight.value = hullmodListHeight(table.value!.clientHeight, filters.value!.offsetHeight, auxiliary.value!.offsetHeight);
  visible.setMediaRoot(list.value);
  viewport.setViewportMetrics({ clientHeight: list.value!.clientHeight, scrollTop: list.value!.scrollTop });
  positionDetails();
}
function sort(key: HullmodSort) {
  if (sortKey.value === key) ascending.value = !ascending.value;
  else {
    sortKey.value = key;
    ascending.value = true;
  }
}
function choose(id: string) {
  if (installed(id)?.category === 'builtin') return;
  inputs.cancel(prefix);
  emit('select', id, category.value);
}
function cancel() {
  inputs.cancel(prefix);
  emit('close');
}
function showDetails(entry: import('@/shared/types').JointVariantEntry) {
  hovered.value = entry.id;
  void nextTick(positionDetails);
}
function leaveRow(event: MouseEvent) {
  if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('.variant-hullmod-tooltip')) hovered.value = '';
}
function leaveDetails(event: MouseEvent) {
  if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('[data-entry-id]')) hovered.value = '';
}
function blurDetails(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('[data-entry-id], .variant-hullmod-tooltip'))
    hovered.value = '';
}
function positionDetails() {
  if (!tooltip.value || !hovered.value) return;
  const row = [...list.value!.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
    (element) => element.dataset.entryId === hovered.value,
  );
  if (!row) {
    hovered.value = '';
    return;
  }
  const bounds = row.getBoundingClientRect(),
    detail = tooltip.value.getBoundingClientRect();
  const left = bounds.right + detail.width <= window.innerWidth - 7 ? bounds.right : Math.max(7, bounds.left - detail.width);
  tooltipPosition.value = { left: left + 'px', top: Math.max(7, Math.min(bounds.top, window.innerHeight - detail.height - 7)) + 'px' };
}
function scroll(event: Event) {
  viewport.onScroll(event);
  positionDetails();
}
watch(
  filtered,
  () => {
    if (!filtered.value.some((entry) => entry.id === hovered.value)) hovered.value = '';
    list.value!.scrollTop = 0;
    measure();
  },
  { flush: 'post' },
);
watch(
  () => props.variant.mods,
  () => {
    void nextTick(positionDetails);
  },
);
const origins = [
  { label: '全部来源', value: 'all' },
  { label: '当前 Mod', value: 'mod' },
  { label: 'Core', value: 'core' },
];
const categories = [
  { label: '普通插件', value: 'normal' },
  { label: '永久插件', value: 'permanent' },
  { label: 'S 插件', value: 's' },
];
onScopeDispose(
  inputs.register({
    key: prefix,
    label: '插件引用ID',
    dirty: computed(() => Boolean(manualId.value)),
    commit: () => null,
    cancel: () => {
      manualId.value = '';
    },
    focus: () => auxiliary.value!.querySelector<HTMLInputElement>('details input')!.focus(),
  }),
);
onScopeDispose(
  inputs.registerFinalizer(() => {
    if (manualId.value) {
      const id = manualId.value;
      manualId.value = '';
      emit('manual-commit', id, category.value);
    }
  }, prefix),
);
async function manual(event?: Event) {
  if (event instanceof KeyboardEvent && event.isComposing) return;
  try {
    await inputs.commit(prefix);
  } catch (error) {
    feedback.error(error);
  }
}
function navigate(event: KeyboardEvent) {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]');
  if (!row || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = filtered.value.findIndex((entry) => entry.id === row.dataset.entryId);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? filtered.value.length - 1
        : Math.max(0, Math.min(filtered.value.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
  list.value!.scrollTop = Math.max(0, next * 36 - list.value!.clientHeight / 2);
  measure();
  void nextTick(() =>
    [...list.value!.querySelectorAll<HTMLElement>('[data-entry-id]')]
      .find((element) => element.dataset.entryId === filtered.value[next]!.id)!
      .focus(),
  );
}
let observer: ResizeObserver;
watch(
  tooltip,
  (next, previous) => {
    if (previous) observer.unobserve(previous);
    if (next) observer.observe(next);
  },
  { flush: 'post' },
);
onMounted(() => {
  surface.value!.focus({ preventScroll: true });
  observer = new ResizeObserver(measure);
  observer.observe(table.value!);
  observer.observe(list.value!);
  observer.observe(auxiliary.value!);
  observer.observe(filters.value!);
  measure();
  window.addEventListener('resize', measure);
});
onScopeDispose(() => {
  observer.disconnect();
  window.removeEventListener('resize', measure);
});
</script>
