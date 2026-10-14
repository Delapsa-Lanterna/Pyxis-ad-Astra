<template>
  <div
    ref="surface"
    class="variant-picker"
    :style="position"
    tabindex="-1"
    @keydown.esc.stop.prevent="hovered ? hover.close(true) : cancel()"
    @keydown="compareKey"
    @keyup="compareKey"
  >
    <header>
      <n-input v-model:value="search" placeholder="搜索 ID／名称" clearable />
    </header>
    <div v-if="currentEntry" class="variant-current-title">
      <ImmersiveText
        text="当前装备 · 按住 Ctrl 比较"
        :runs="[{ text: '当前装备 · 按住 ' }, { text: 'Ctrl', color: '#ffd200' }, { text: ' 比较' }]"
        font="heading"
        block
      />
    </div>
    <VariantCandidateCard
      v-if="currentEntry"
      :root="root"
      :kind="kind"
      :entry="currentEntry"
      :media-url="(resource) => preload.url(root.sessionId, resource)"
      :cost="cost(currentEntry)"
      diagnostic=""
      current
      @select="choose('')"
      @hover="showCandidate(currentId, $event)"
      @leave="hover.leave"
    />
    <div class="variant-picker-filters" :class="{ 'weapon-filter-grid': kind === 'weapons' }">
      <ImmersiveFilterToggle
        v-for="option in filterOptions"
        :key="option.value"
        :label="option.label"
        :text="option.label"
        :checked="(option.group === 'size' ? sizes : types).includes(option.value)"
        :color="option.color"
        font="filter"
        @toggle="toggleFilter(option)"
      />
    </div>
    <div ref="listSurface" class="variant-picker-list" @scroll="scrollList">
      <ImmersiveText v-if="loading" text="正在读取候选目录" />
      <div v-else-if="errorText"><ImmersiveText :text="errorText" block /><n-button @click="load">重试</n-button></div>
      <template v-else>
        <div :style="{ height: viewport.beforeHeight.value + 'px' }" aria-hidden="true" />
        <template v-for="(entry, index) in viewport.visibleItems.value" :key="entry.id">
          <VariantCandidateCard
            :data-entry-id="entry.id"
            :root="root"
            :kind="kind"
            :entry="entry"
            :media-url="(resource) => preload.url(root.sessionId, resource)"
            :in-view="
              viewport.startIndex.value + index >= viewport.firstVisibleIndex.value &&
              viewport.startIndex.value + index < viewport.lastVisibleIndex.value
            "
            :cost="cost(entry)"
            :diagnostic="diagnostic(entry)"
            @select="choose(entry.id)"
            @hover="showCandidate(entry.id, $event)"
            @leave="hover.leave"
          />
        </template>
        <div :style="{ height: viewport.afterHeight.value + 'px' }" aria-hidden="true" />
        <ImmersiveText v-if="!filtered.length" text="没有匹配候选" block />
      </template>
    </div>
    <details class="variant-picker-extra">
      <summary class="immersive-disclosure-summary"><ImmersiveText text="来源与 ID" font="caption" ink-aligned /></summary>
      <n-select v-model:value="origin" :options="origins" />
      <footer>
        <n-input v-model:value="manualId" placeholder="手动填写 ID" @keydown.enter.stop.prevent="manual" /><n-button @click="manual"
          >提交 ID</n-button
        >
      </footer>
    </details>
  </div>
  <div
    v-if="hovered"
    :ref="(element) => (hover.surface.value = element as HTMLElement | null)"
    class="variant-picker-tooltip"
    :style="hover.position.value"
    tabindex="-1"
    role="dialog"
    :aria-label="kind === 'weapons' ? '武器只读信息' : '联队只读信息'"
    @mouseenter="hover.keep"
    @mouseleave="hover.leave"
    @focusin="hover.keep"
    @focusout="hover.leave"
    @keydown.esc.stop.prevent="hover.close(true)"
    @keydown="compareKey"
    @keyup="compareKey"
  >
    <VariantCandidateDetails :root="root" :kind="kind" :id="hovered" /><VariantCandidateDetails
      v-if="compare && currentId && currentId !== hovered"
      :root="root"
      :kind="kind"
      :id="currentId"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onScopeDispose, watch, nextTick } from 'vue';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { JointVariantEntry, JointEditRoot, RowData } from '@/shared/types';
import { useVariantCatalog } from '@/app/composables/use-variant-catalog';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { weaponNumber } from '@/domain/immersive/weapon-statistics';
import { weaponSlotCompatibility, isSystemWeapon, type HullmodCategory } from '@/domain/immersive/variant-actions';
import { weaponFilterDefaults, weaponFilterMatches, VARIANT_CARD_STEP } from '@/domain/immersive/variant-picker';
import { weaponTypeColor } from '@/domain/immersive/weapon-icon';
import ImmersiveText from './ImmersiveText.vue';
import VariantCandidateDetails from './VariantCandidateDetails.vue';
import VariantCandidateCard from './VariantCandidateCard.vue';
import ImmersiveFilterToggle from './ImmersiveFilterToggle.vue';
import { useCsvGridViewport } from '@/app/composables/tables/use-csv-grid-viewport';
import { useImmersiveHover } from '@/app/composables/use-immersive-hover';
import { useImagePreload } from '@/app/composables/use-image-preload';
import { variantCandidateResources } from '@/domain/immersive/variant-panel';
const props = defineProps<{
  root: JointEditRoot;
  kind: 'weapons' | 'wings';
  weaponSlot?: RowData;
  currentId: string;
  anchor: { x: number; y: number };
  commitManual: (id: string) => Promise<boolean>;
}>();
const emit = defineEmits<{
  select: [id: string, category: HullmodCategory];
  close: [];
}>();
const surface = ref<HTMLElement | null>(null),
  listSurface = ref<HTMLElement | null>(null),
  search = ref(''),
  origin = ref('all'),
  types = ref<string[]>(props.kind === 'weapons' ? weaponFilterDefaults(props.weaponSlot!).types : ['INTERCEPTOR', 'FIGHTER', 'BOMBER']),
  sizes = ref<string[]>(props.kind === 'weapons' ? weaponFilterDefaults(props.weaponSlot!).sizes : []),
  manualId = ref(''),
  compare = ref(false);
const hover = useImmersiveHover<string>(
  (): number => (compare.value && props.currentId && props.currentId !== hover.selected.value ? 847 : 422),
  () => (props.kind === 'weapons' ? 'left' : 'right'),
);
const hovered = computed(() => hover.selected.value ?? '');
function showCandidate(id: string, event: MouseEvent | FocusEvent) {
  hover.show(id, event.currentTarget as HTMLElement, event.type === 'focus' ? 'focus' : 'hover');
}
const { entries, loading, errorText, load } = useVariantCatalog(
  () => props.root,
  () => props.kind,
);
const origins = [
  { label: '全部来源', value: 'all' },
  { label: '当前 Mod', value: 'mod' },
  { label: 'Core', value: 'core' },
];
const data = (entry: JointVariantEntry) => (isRowData(entry.data) ? entry.data : {});
const string = (entry: JointVariantEntry, key: string) => schemaStringValue(data(entry)[key]);
const label = (entry: JointVariantEntry) => entry.label;
const filterOptions = computed(() =>
  props.kind === 'weapons'
    ? [
        { label: '实弹', value: 'BALLISTIC', group: 'type', color: weaponTypeColor('BALLISTIC') },
        { label: '能量', value: 'ENERGY', group: 'type', color: weaponTypeColor('ENERGY') },
        { label: '导弹', value: 'MISSILE', group: 'type', color: weaponTypeColor('MISSILE') },
        { label: '小型', value: 'SMALL', group: 'size', color: '#aadeff' },
        { label: '中型', value: 'MEDIUM', group: 'size', color: '#aadeff' },
        { label: '大型', value: 'LARGE', group: 'size', color: '#aadeff' },
      ]
    : [
        { label: '截击机', value: 'INTERCEPTOR', group: 'type', color: '#aadeff' },
        { label: '战斗机', value: 'FIGHTER', group: 'type', color: '#aadeff' },
        { label: '轰炸机', value: 'BOMBER', group: 'type', color: '#aadeff' },
      ],
);
function toggleFilter(option: { value: string; group: string }) {
  const selected = option.group === 'size' ? sizes : types;
  selected.value = selected.value.includes(option.value)
    ? selected.value.filter((value) => value !== option.value)
    : [...selected.value, option.value];
}
function cost(entry: JointVariantEntry) {
  return weaponNumber(data(entry), props.kind === 'weapons' ? 'OPs' : 'op cost', NaN);
}
function diagnostic(entry: JointVariantEntry) {
  return props.kind === 'weapons' && props.weaponSlot
    ? !isRowData(entry.spec)
      ? '武器规格来源缺失'
      : weaponSlotCompatibility(props.weaponSlot, entry.spec)
    : '';
}
const currentEntry = computed(() => (props.currentId ? entries.value.find((entry) => entry.id === props.currentId) : undefined));
const position = ref({ left: '0px', top: '0px' });
function locate() {
  const bounds = surface.value!.getBoundingClientRect();
  const detailWidth = compare.value && props.currentId !== hovered.value ? 847 : 422;
  const preferred =
    props.kind === 'wings'
      ? Math.min(props.anchor.x, window.innerWidth - bounds.width - detailWidth - 14)
      : Math.max(props.anchor.x, detailWidth + 10);
  const x = Math.max(7, Math.min(preferred, window.innerWidth - bounds.width - 7));
  const y = Math.max(7, Math.min(props.anchor.y - bounds.height / 2, window.innerHeight - bounds.height - 7));
  position.value = { left: x + 'px', top: y + 'px' };
  hover.locate();
  measureList();
}
const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  const items = entries.value.filter(
    (entry) =>
      Boolean(entry.id) &&
      (props.kind !== 'weapons' || !isSystemWeapon(data(entry), isRowData(entry.spec) ? entry.spec : {})) &&
      (origin.value === 'all' || entry.source.source === origin.value) &&
      (!needle || [entry.id, label(entry)].some((value) => value.toLowerCase().includes(needle))) &&
      (props.kind === 'weapons'
        ? isRowData(entry.spec) && weaponFilterMatches(entry.spec, types.value, sizes.value)
        : types.value.includes(['INTERCEPTOR', 'BOMBER'].includes(string(entry, 'role')) ? string(entry, 'role') : 'FIGHTER')),
  );
  items.sort((a, b) => {
    const left = cost(a),
      right = cost(b);
    if (Number.isNaN(left) || Number.isNaN(right)) return Number.isNaN(left) === Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1;
    return right - left;
  });
  return items;
});
const viewport = useCsvGridViewport(filtered, { editingIndex: ref(null), rowHeight: VARIANT_CARD_STEP, overscan: 2 });
const preload = useImagePreload('装配候选预读');
const candidateResources = new WeakMap<JointVariantEntry, import('@/shared/types').ResourceRef[]>();
function preloadImages() {
  const list = listSurface.value!,
    start = Math.floor(list.scrollTop / VARIANT_CARD_STEP),
    count = Math.ceil(list.clientHeight / VARIANT_CARD_STEP),
    resources = (entries: JointVariantEntry[]) =>
      entries.flatMap((entry) => {
        let resources = candidateResources.get(entry);
        if (!resources) {
          resources = variantCandidateResources(entry, props.kind);
          candidateResources.set(entry, resources);
        }
        return resources;
      });
  preload.prepare(
    props.root.sessionId,
    [...resources(currentEntry.value ? [currentEntry.value] : []), ...resources(filtered.value.slice(start, start + count))],
    resources(filtered.value.slice(Math.max(0, start - count), start + count * 2)),
  );
}
function measureList() {
  const list = listSurface.value!;
  viewport.setViewportMetrics({ clientHeight: list.clientHeight, scrollTop: list.scrollTop });
  preloadImages();
}
function scrollList(event: Event) {
  hover.close();
  viewport.onScroll(event);
  preloadImages();
}
watch(
  filtered,
  () => {
    if (hovered.value !== props.currentId && !filtered.value.some((entry) => entry.id === hovered.value)) hover.close();
    listSurface.value!.scrollTop = 0;
    locate();
  },
  { flush: 'post' },
);
watch(compare, locate, { flush: 'post' });
const inputs = useFieldInputs()!,
  feedback = useAppFeedback(),
  prefix = 'variant-picker/manual';
onScopeDispose(
  inputs.register({
    key: prefix,
    label: '装配引用 ID',
    dirty: computed(() => Boolean(manualId.value)),
    commit: () => null,
    cancel: () => {
      manualId.value = '';
    },
    focus: () => surface.value?.querySelector<HTMLInputElement>('footer input')?.focus(),
  }),
);
onScopeDispose(
  inputs.registerFinalizer(async () => {
    if (manualId.value) {
      const id = manualId.value;
      manualId.value = '';
      const accepted = await props.commitManual(id);
      if (!accepted) manualId.value = id;
      return accepted;
    }
  }, prefix),
);
async function manual() {
  try {
    await inputs.commit(prefix);
  } catch (error) {
    feedback.error(error);
  }
}
function cancel() {
  inputs.cancel(prefix);
  emit('close');
}
function choose(id: string) {
  inputs.cancel(prefix);
  emit('select', id, 'normal');
}
function compareKey(event: KeyboardEvent) {
  compare.value = event.ctrlKey;
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-entry-id]');
  if (event.type !== 'keydown' || !row || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = filtered.value.findIndex((entry) => entry.id === row.dataset.entryId);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? filtered.value.length - 1
        : Math.max(0, Math.min(filtered.value.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
  const height = VARIANT_CARD_STEP;
  listSurface.value!.scrollTop = Math.max(0, next * height - listSurface.value!.clientHeight / 2);
  measureList();
  void nextTick(() => {
    [...listSurface.value!.querySelectorAll<HTMLElement>('[data-entry-id]')]
      .find((item) => item.dataset.entryId === filtered.value[next]!.id)!
      .focus();
  });
}
onMounted(() => {
  surface.value!.focus({ preventScroll: true });
  locate();
  measureList();
  observer = new ResizeObserver(locate);
  observer.observe(surface.value!);
  window.addEventListener('resize', locate);
});
let observer: ResizeObserver;
onScopeDispose(() => {
  observer.disconnect();
  window.removeEventListener('resize', locate);
});
defineExpose({ cancel });
</script>
