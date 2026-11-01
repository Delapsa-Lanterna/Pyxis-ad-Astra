<template>
  <div
    ref="surface"
    class="variant-picker ui-layout-row ui-layout-stack ui-content-surface"
    :style="position"
    tabindex="-1"
    @keydown.esc.stop.prevent="hovered ? hover.close(true) : cancel()"
    @keydown="compareKey"
    @keyup="compareKey"
  >
    <header class="variant-picker-heading ui-control-between">
      <n-input v-model:value="search" placeholder="搜索 ID／名称" clearable />
    </header>
    <div v-if="currentEntry" class="variant-current-title">
      <ImmersiveText v-if="kind === 'variants'" text="当前模块 · 点击卸下" font="heading" block /><ImmersiveText
        v-else
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
      :media-url="mediaUrl"
      :cost="cost(currentEntry)"
      diagnostic=""
      current
      @select="choose('')"
      @hover="showCandidate(currentId, $event)"
      @leave="hover.leave"
    />
    <div v-if="kind === 'variants'" class="variant-picker-filters ui-layout-grid">
      <ImmersiveFilterToggle
        v-for="source in moduleSources"
        :key="source.value"
        :label="source.label"
        :text="source.label"
        :checked="selectedSources.includes(source.value)"
        color="#aadeff"
        font="filter"
        @toggle="toggleSource(source.value)"
      />
    </div>
    <div v-else class="variant-picker-filters ui-layout-grid" :class="{ 'weapon-filter-grid': kind === 'weapons' }">
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
    <button
      v-if="kind === 'variants'"
      class="variant-module-edit ui-button ui-control-button ui-control-border ui-text-normal"
      :disabled="!moduleContext?.variant"
      @click="$emit('edit-module')"
    >
      <ImmersiveText text="编辑模块装配" font="heading" />
    </button>
    <div ref="listSurface" data-media-viewport class="variant-picker-list" @scroll="scrollList">
      <ImmersiveText v-if="loading" text="正在读取候选目录" />
      <div v-else-if="errorText"><ImmersiveText :text="errorText" block /><n-button @click="load">重试</n-button></div>
      <template v-else>
        <template v-for="view in viewport.entries.value" :key="view.key">
          <div v-if="view.kind === 'gap'" :style="{ height: view.height + 'px' }" data-retained-gap aria-hidden="true" />
          <VariantCandidateCard
            v-else
            v-show="!view.hidden"
            @vue:mounted="debugLog('list.item_mounted', () => ({ kind, id: view.item.id, sessionId: root.sessionId }))"
            :data-entry-id="view.item.id"
            :root="root"
            :kind="kind"
            :entry="view.item"
            :media-url="mediaUrl"
            :active="view.active"
            :cost="cost(view.item)"
            :diagnostic="diagnostic(view.item)"
            @select="choose(view.item.id)"
            @hover="showCandidate(view.item.id, $event)"
            @leave="hover.leave"
          />
        </template>
        <ImmersiveText v-if="!filtered.length" text="没有匹配候选" block />
      </template>
    </div>
    <details class="variant-picker-extra">
      <summary class="immersive-disclosure-summary ui-layout-row ui-layout-center ui-control-pointer">
        <ImmersiveText text="来源与 ID" font="caption" ink-aligned />
      </summary>
      <n-select v-if="kind !== 'variants'" :virtual-scroll="false" v-model:value="origin" :options="origins" />
      <footer class="variant-picker-extra-footer ui-footer ui-layout-row">
        <n-input v-model:value="manualId" placeholder="手动填写 ID" @keydown.enter.stop.prevent="manual" /><n-button @click="manual"
          >提交 ID</n-button
        >
      </footer>
    </details>
  </div>
  <div
    v-if="hovered"
    :ref="(element) => (hover.surface.value = element as HTMLElement | null)"
    class="variant-picker-tooltip ui-layout-row"
    :style="{ ...hover.position.value, '--candidate-detail-width': detailPaneWidth + 'px' }"
    tabindex="-1"
    role="dialog"
    :aria-label="kind === 'variants' ? '模块装配只读信息' : kind === 'weapons' ? '武器只读信息' : '战机联队只读信息'"
    @mouseenter="hover.keep"
    @mouseleave="hover.leave"
    @focusin="hover.keep"
    @focusout="hover.leave"
    @keydown.esc.stop.prevent="hover.close(true)"
    @keydown="compareKey"
    @keyup="compareKey"
  >
    <VariantCandidateDetails
      :root="root"
      :kind="kind"
      :id="hovered"
      :current-variant="kind === 'variants' && hovered === currentId ? moduleContext?.variant : undefined"
      :current-snapshot="moduleContext?.snapshot"
      :current-values="moduleContext?.values"
      :current-render="moduleContext?.render"
    /><VariantCandidateDetails v-if="compare && currentId && currentId !== hovered" :root="root" :kind="kind" :id="currentId" />
  </div>
</template>
<script setup lang="ts">
import { useLayoutFrame } from '@/shared/runtime/use-layout-frame';
import { computed, ref, onMounted, onScopeDispose, watch, type ComputedRef } from 'vue';
import { debugLog } from '@/shared/runtime/app-log-queue';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type {
  ReadonlyVariantEntry,
  JointEditRoot,
  RowData,
  ResourceSource,
  JointEditSnapshot,
  JointValue,
  ResourceRef,
} from '@/shared/types';
import type { VariantProjection } from '@/domain/immersive/variant/variant-panel';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import { useVariantCatalog } from '@/app/composables/immersive-editor/variant/use-variant-catalog';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { immersiveNumber } from '@/domain/immersive/fields';
import { weaponSlotCompatibility, isSystemWeapon, type HullmodCategory } from '@/domain/immersive/variant/variant-actions';
import { weaponFilterDefaults, weaponFilterMatches, VARIANT_CARD_STEP } from '@/domain/immersive/variant/variant-picker';
import { weaponTypeColor } from '@/domain/immersive/weapon-icon';
import ImmersiveText from '../ImmersiveText.vue';
import VariantCandidateDetails from './VariantCandidateDetails.vue';
import VariantCandidateCard from './VariantCandidateCard.vue';
import ImmersiveFilterToggle from '../ImmersiveFilterToggle.vue';
import { useRetainedList } from '@/shared/runtime/retained-list';
import { useImmersiveHover } from '@/app/composables/use-immersive-hover';
import { useThumbnailPreload } from '@/app/composables/use-thumbnail-preload';
import { variantCandidateThumbnail } from '@/app/composables/immersive-editor/variant/variant-candidate-thumbnail';
const props = defineProps<{
  root: JointEditRoot;
  kind: 'weapons' | 'wings' | 'variants';
  moduleContext?: {
    entry?: ReadonlyVariantEntry;
    variant?: VariantProjection;
    snapshot: JointEditSnapshot;
    values: Record<string, JointValue>;
    render: ImmersiveRenderContext;
  };
  weaponSlot?: RowData;
  currentId: string;
  anchor: { x: number; y: number };
  commitManual: (id: string) => Promise<boolean>;
}>();
const emit = defineEmits<{
  select: [id: string, category: HullmodCategory];
  close: [];
  'edit-module': [];
}>();
const surface = ref<HTMLElement | null>(null),
  listSurface = ref<HTMLElement | null>(null),
  search = ref(''),
  origin = ref('all'),
  types = ref<string[]>(props.kind === 'weapons' ? weaponFilterDefaults(props.weaponSlot!).types : ['INTERCEPTOR', 'FIGHTER', 'BOMBER']),
  sizes = ref<string[]>(props.kind === 'weapons' ? weaponFilterDefaults(props.weaponSlot!).sizes : []),
  manualId = ref(''),
  compare = ref(false);
const moduleSources = [
  { label: '原版', value: 'core' as const },
  { label: '本 MOD', value: 'mod' as const },
  { label: '引用 MOD', value: 'reference' as const },
];
const selectedSources = ref<ResourceSource[]>(['mod']);
const viewportWidth = ref(window.innerWidth);
const comparing = computed(() => compare.value && props.currentId && props.currentId !== hover.selected.value);
const detailPaneWidth = computed(() =>
  Math.min(
    props.kind === 'variants' ? 832 : 422,
    Math.max(240, (viewportWidth.value - 411 - (comparing.value ? 3 : 0)) / (comparing.value ? 2 : 1)),
  ),
);
const detailWidth = computed(() => detailPaneWidth.value * (comparing.value ? 2 : 1) + (comparing.value ? 3 : 0));
function toggleSource(source: ResourceSource) {
  selectedSources.value = selectedSources.value.includes(source)
    ? selectedSources.value.filter((value) => value !== source)
    : [...selectedSources.value, source];
}
const hover = useImmersiveHover<string>(
  (): number => detailWidth.value,
  () => (props.kind === 'wings' ? 'right' : 'left'),
);
const hovered = computed(() => hover.selected.value ?? '');
function showCandidate(id: string, event: MouseEvent | FocusEvent) {
  hover.show(id, event.currentTarget as HTMLElement, event.type === 'focus' ? 'focus' : 'hover');
}
const mainCatalog = useVariantCatalog(
  () => props.root,
  () => props.kind,
  () => props.kind !== 'variants' || selectedSources.value.some((source) => source !== 'core'),
  () => (props.kind === 'variants' ? 'mod' : undefined),
);
const coreCatalog = useVariantCatalog(
  () => props.root,
  () => 'variants',
  () => props.kind === 'variants' && selectedSources.value.includes('core'),
  () => 'core',
);
const entries = computed(() =>
  props.kind === 'variants'
    ? [
        ...mainCatalog.entries.value.filter(
          (entry) => entry.source.source !== 'core' && selectedSources.value.includes(entry.source.source),
        ),
        ...coreCatalog.entries.value.filter((entry) => selectedSources.value.includes('core') && entry.source.source === 'core'),
      ]
    : mainCatalog.entries.value,
);
const loading = computed(() => mainCatalog.loading.value || coreCatalog.loading.value);
const errorText = computed(() => mainCatalog.errorText.value || coreCatalog.errorText.value);
function load() {
  if (props.kind !== 'variants' || selectedSources.value.some((source) => source !== 'core')) void mainCatalog.load();
  if (props.kind === 'variants' && selectedSources.value.includes('core')) void coreCatalog.load();
}
const origins = [
  { label: '全部来源', value: 'all' },
  { label: '当前 Mod', value: 'mod' },
  { label: 'Core', value: 'core' },
];
const data = (entry: ReadonlyVariantEntry) => (isRowData(entry.data) ? entry.data : {});
const string = (entry: ReadonlyVariantEntry, key: string) => schemaStringValue(data(entry)[key]);
const label = (entry: ReadonlyVariantEntry) => entry.label;
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
function cost(entry: ReadonlyVariantEntry) {
  return immersiveNumber(data(entry), props.kind === 'weapons' ? 'OPs' : 'op cost', NaN);
}
function diagnostic(entry: ReadonlyVariantEntry) {
  return props.kind === 'weapons' && props.weaponSlot
    ? !isRowData(entry.spec)
      ? '武器规格来源缺失'
      : weaponSlotCompatibility(props.weaponSlot, entry.spec)
    : '';
}
const currentEntry = computed(
  () => props.moduleContext?.entry ?? (props.currentId ? entries.value.find((entry) => entry.id === props.currentId) : undefined),
);
const position = ref({ left: '0px', top: '0px' });
function locate() {
  viewportWidth.value = window.innerWidth;
  const bounds = surface.value!.getBoundingClientRect();
  const preferred =
    props.kind === 'wings'
      ? Math.min(props.anchor.x, window.innerWidth - bounds.width - detailWidth.value - 14)
      : Math.max(props.anchor.x, detailWidth.value + 10);
  const x = Math.max(7, Math.min(preferred, window.innerWidth - bounds.width - 7));
  const y = Math.max(7, Math.min(props.anchor.y - bounds.height / 2, window.innerHeight - bounds.height - 7));
  const left = x + 'px',
    top = y + 'px';
  if (position.value.left !== left || position.value.top !== top) position.value = { left, top };
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
      (!needle || [entry.id, label(entry), entry.moduleHull?.name ?? ''].some((value) => value.toLowerCase().includes(needle))) &&
      (props.kind === 'variants'
        ? entry.moduleHull?.hints.includes('MODULE')
        : props.kind === 'weapons'
          ? isRowData(entry.spec) && weaponFilterMatches(entry.spec, types.value, sizes.value)
          : types.value.includes(['INTERCEPTOR', 'BOMBER'].includes(string(entry, 'role')) ? string(entry, 'role') : 'FIGHTER')),
  );
  items.sort((a, b) => {
    if (props.kind === 'variants')
      return (
        (a.moduleHull?.name ?? '').localeCompare(b.moduleHull?.name ?? '') || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
      );
    const left = cost(a),
      right = cost(b);
    if (Number.isNaN(left) || Number.isNaN(right)) return Number.isNaN(left) === Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1;
    return right - left;
  });
  return items;
});
const entryById = computed(() => new Map(entries.value.map((entry) => [entry.id, entry])));
const viewport = useRetainedList(
  () => filtered.value.map((entry) => entry.id),
  (key) => entryById.value.get(key),
  (entry) => entry.id,
  VARIANT_CARD_STEP,
);
watch(() => JSON.stringify([props.root.sessionId, props.root.modRoot, props.kind]), viewport.reset, { flush: 'sync' });
const preload = useThumbnailPreload('装配候选预读');
const thumbnailRequests = new WeakMap<ReadonlyVariantEntry, ComputedRef<ReturnType<typeof variantCandidateThumbnail>>>();
const mediaUrl = (resource: ResourceRef) => preload.url(props.root.sessionId, resource);
function preloadImages() {
  const list = listSurface.value!,
    start = Math.floor(list.scrollTop / VARIANT_CARD_STEP),
    count = Math.ceil(list.clientHeight / VARIANT_CARD_STEP);
  const requests = (items: ReadonlyVariantEntry[]) =>
    items
      .map((entry) => {
        let request = thumbnailRequests.get(entry);
        if (!request) {
          request = computed(() => variantCandidateThumbnail(props.root.sessionId, entry, props.kind));
          thumbnailRequests.set(entry, request);
        }
        return request.value;
      })
      .filter((request) => request !== null);
  preload.prepare(
    props.root.sessionId,
    requests([...(currentEntry.value ? [currentEntry.value] : []), ...filtered.value.slice(start, start + count)]),
    requests(filtered.value.slice(Math.max(0, start - count), start + count * 2)),
  );
}
function measureList() {
  const list = listSurface.value!;
  viewport.setViewportMetrics({ clientHeight: list.clientHeight, scrollTop: list.scrollTop });
  preloadImages();
}
let scrollFrame = 0;
function scrollList() {
  hover.close();
  if (!scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      measureList();
    });
}
onScopeDispose(() => cancelAnimationFrame(scrollFrame));
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
    return undefined;
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
  compare.value = props.kind !== 'variants' && event.ctrlKey;
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
  const id = filtered.value[next]!.id;
  void viewport.ensure(next).then((ready) => {
    if (!ready) return;
    [...listSurface.value!.querySelectorAll<HTMLElement>('[data-entry-id]')].find((item) => item.dataset.entryId === id)!.focus();
  });
}
const scheduleLocate = useLayoutFrame(locate);
onMounted(() => {
  surface.value!.focus({ preventScroll: true });
  locate();
  observer = new ResizeObserver(scheduleLocate);
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
