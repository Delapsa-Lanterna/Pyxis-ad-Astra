<template>
  <div
    ref="surface"
    class="variant-hullmod-dialog ui-text-reset"
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
      class="variant-hullmod-table ui-layout-row ui-layout-stack"
      :style="{ '--hullmod-columns': columnWidths.map((value) => value + 'px').join(' ') }"
    >
      <header class="variant-hullmod-columns ui-layout-grid ui-layout-center">
        <button
          class="ui-button variant-hullmod-columns-button ui-control-center ui-control-pointer ui-control-reset ui-control-border"
          v-for="column in columns"
          :key="column.key"
          :aria-label="column.label + '排序'"
          :aria-sort="sortKey === column.key ? (ascending ? 'ascending' : 'descending') : 'none'"
          @click="sort(column.key)"
        >
          <ImmersiveText :text="column.label" font="heading" ink-aligned outlined /><ImmersiveResourceIcon
            :source="uiImages.sortIcon || ''"
            fallback="sortIcon"
            color="#aadeff"
            :size="15"
            label="排序"
            :class="{ ascending: sortKey === column.key && ascending }"
          />
        </button>
      </header>
      <div ref="list" class="variant-hullmod-list ui-control-border" :style="{ height: listHeight + 'px' }" @scroll="scroll">
        <ImmersiveText v-if="loading" text="正在读取插件目录" />
        <div v-else-if="errorText"><ImmersiveText :text="errorText" block /><n-button @click="load()">重试</n-button></div>
        <template v-else>
          <template v-for="view in viewport.entries.value" :key="view.key">
            <div v-if="view.kind === 'gap'" :style="{ height: view.height + 'px' }" data-retained-gap aria-hidden="true" />
            <button
              v-else
              v-show="!view.hidden"
              @vue:mounted="debugLog('list.item_mounted', () => ({ kind: 'hullmods', id: view.item.id, sessionId: root.sessionId }))"
              :data-entry-id="view.item.id"
              class="variant-hullmod-row ui-button ui-control-button ui-layout-grid ui-layout-center ui-layout-stretch ui-control-reset"
              :class="{
                installed: Boolean(installed(view.item.id)),
                'variant-list-active': view.active,
                unavailable: installed(view.item.id)?.category === 'builtin' || Boolean(state(view.item).diagnostic),
              }"
              :aria-disabled="installed(view.item.id)?.category === 'builtin'"
              :title="state(view.item).label + (state(view.item).diagnostic ? '\n' + state(view.item).diagnostic : '')"
              @mouseenter="showDetails(view.item)"
              @mouseleave="leaveRow"
              @focus="showDetails(view.item)"
              @click="choose(view.item.id)"
            >
              <span
                class="variant-hullmod-name variant-hullmod-row-label ui-control-row ui-layout-clip"
                :title="view.item.label"
                :style="{ color: state(view.item).color }"
                ><span :ref="visible.mediaRef('icon/' + view.item.id, view.item.resourceRefs.icon)" class="variant-hullmod-icon"
                  ><ImmersiveHullmodIcon
                    :session-id="root.sessionId"
                    :resource="view.item.resourceRefs.icon"
                    :active="view.active"
                    :label="view.item.label"
                    :size="32" /></span
                ><ImmersiveText :active="view.active" :text="rowText(view.item).name" ink-aligned outlined
              /></span>
              <span
                class="variant-hullmod-design variant-hullmod-row-label ui-control-row ui-layout-clip"
                :style="{ color: designTypeColor(reference, hullmodDesign(view.item)) }"
                ><ImmersiveText :active="view.active" :text="rowText(view.item).design" ink-aligned outlined
              /></span>
              <span class="variant-hullmod-row-label ui-control-row ui-layout-clip" :style="{ color: state(view.item).costColor }"
                ><ImmersiveText :active="view.active" :text="state(view.item).costText" ink-aligned outlined
              /></span>
              <span class="variant-hullmod-row-label ui-control-row ui-layout-clip"
                ><ImmersiveResourceIcon
                  v-if="installed(view.item.id)"
                  :source="uiImages[state(view.item).iconKey] || ''"
                  :fallback="state(view.item).iconKey"
                  :color="state(view.item).iconColor"
                  :size="20"
                  :label="state(view.item).label"
              /></span>
            </button>
          </template>
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
      <div ref="auxiliary" class="variant-hullmod-auxiliary ui-layout-row ui-layout-stack">
        <n-input v-model:value="search" placeholder="搜索 ID／名称" clearable />
        <details @toggle="measure">
          <summary class="immersive-disclosure-summary ui-layout-row ui-layout-center ui-control-pointer">
            <ImmersiveText text="来源与安装选项" font="caption" ink-aligned />
          </summary>
          <div class="variant-hullmod-extra ui-layout-grid">
            <n-select :virtual-scroll="false" v-model:value="origin" :options="origins" /><n-select
              :virtual-scroll="false"
              v-model:value="category"
              :options="categories"
            /><n-input v-model:value="manualId" placeholder="手动填写 ID" @keydown.enter.stop.prevent="manual" /><n-button @click="manual"
              >提交 ID</n-button
            >
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
import { useLayoutFrame } from '@/shared/runtime/use-layout-frame';
import { computed, ref, watch, nextTick, onMounted, onScopeDispose, type ComputedRef } from 'vue';
import { debugLog } from '@/shared/runtime/app-log-queue';
import type { JointEditRoot, ReadonlyVariantEntry } from '@/shared/types';
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
import { useRetainedList } from '@/shared/runtime/retained-list';
import ImmersiveHullmodIcon from './ImmersiveHullmodIcon.vue';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
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
const state = (entry: ReadonlyVariantEntry) =>
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
const entryById = computed(() => new Map(entries.value.map((entry) => [entry.id, entry])));
const viewport = useRetainedList(
  () => filtered.value.map((entry) => entry.id),
  (key) => entryById.value.get(key),
  (entry) => entry.id,
  36,
);
watch(() => JSON.stringify([props.root.sessionId, props.root.modRoot]), viewport.reset, { flush: 'sync' });
const visible = useVisibleResourceMedia({
  sessionId: () => props.root.sessionId,
  surface: '插件选择列表',
  failureLabel: '插件图片读取失败',
  onFailures: () => undefined,
});
const feedback = useAppFeedback(),
  inputs = useFieldInputs()!,
  prefix = 'variant-hullmod/manual';
const media = useResourceMediaRegistry({
  onError: feedback.error,
  onFailures: () => undefined,
});
const uiKeys = computed(() => [
  'sortIcon',
  'ui_border1b_e',
  'ui_border1b_e_bot',
  'ui_border1b_e_top',
  'ui_border1b_w',
  'ui_border1b_w_bot',
  'ui_border1b_w_top',
  'checkmark',
  'checkmark_locked',
  'checkmark_unlocked',
]);
const uiImages = computed(() =>
  Object.fromEntries(
    uiKeys.value.map((key) => [key, media.dataUrl(props.root.sessionId, reference.value.referenceSettings.resources[key]) ?? '']),
  ),
);
watch(
  [reference, uiKeys],
  ([value, keys]) => {
    void media.replaceCollection(
      props.root.sessionId,
      'hullmod-ui',
      keys.flatMap((key) => (value.referenceSettings.resources[key] ? [value.referenceSettings.resources[key]!] : [])),
    );
  },
  { immediate: true },
);
const selected = computed(() => (hovered.value ? availableEntries.value.find((entry) => entry.id === hovered.value) : undefined));
const measureText = useFontMeasurement(immersiveFontIds.body);
const rowLabels = new WeakMap<ReadonlyVariantEntry, ComputedRef<{ name: string; design: string }>>();
function rowText(entry: ReadonlyVariantEntry) {
  let labels = rowLabels.get(entry);
  if (!labels) {
    labels = computed(() => ({
      name: abbreviate(entry.label, columnWidths.value[0]! - 56),
      design: abbreviate(hullmodDesign(entry), columnWidths.value[1]! - 6),
    }));
    rowLabels.set(entry, labels);
  }
  return labels.value;
}
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
function showDetails(entry: ReadonlyVariantEntry) {
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
  const next = { left: left + 'px', top: Math.max(7, Math.min(bounds.top, window.innerHeight - detail.height - 7)) + 'px' };
  if (next.left !== tooltipPosition.value.left || next.top !== tooltipPosition.value.top) tooltipPosition.value = next;
}
function scroll() {
  viewport.setViewportMetrics({ scrollTop: list.value!.scrollTop, clientHeight: list.value!.clientHeight });
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
  const id = filtered.value[next]!.id;
  void viewport.ensure(next).then((ready) => {
    if (ready) [...list.value!.querySelectorAll<HTMLElement>('[data-entry-id]')].find((element) => element.dataset.entryId === id)!.focus();
  });
}
let observer: ResizeObserver;
const scheduleMeasure = useLayoutFrame(measure);
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
  observer = new ResizeObserver(scheduleMeasure);
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
