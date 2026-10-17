<template>
  <div v-if="current" class="variant-immersive-panel ui-layout-clip ui-layout-stretch">
    <ImmersiveHullScene
      ref="scene"
      :variant="current"
      :session-id="vm.joint.currentTarget.value!.sessionId"
      @slot="openWeaponPicker"
      @module="selectModule"
      @blank="candidatePicker?.cancel()"
    />
    <header class="variant-refit-header">
      <ImmersivePanelRow :stat="current.fields[0]!" :render="render" />
      <div class="variant-refit-tools ui-layout-row ui-layout-stack">
        <slot name="meta" />
        <n-button size="small" title="滚轮缩放 · 右键平移 · 点击槽位装配" @click="scene!.fit()">居中</n-button>
        <n-select v-if="panel.variants.length > 1" :value="current.key" :options="moduleOptions" @update:value="selectModule" />
      </div>
    </header>
    <div class="variant-refit-actions ui-layout-row">
      <button
        ref="groupsButton"
        class="variant-cut-button ui-button variant-refit-actions-button ui-layout-inline ui-layout-center ui-control-pointer ui-content-surface-muted ui-control-reset"
        :disabled="!current.editable || vm.joint.saving.value || vm.referenceChanging.value"
        @click="openGroups"
      >
        <ImmersiveText text="调整武器组" font="picker-title" ink-aligned />
      </button>
      <button
        class="variant-cut-button ui-button variant-refit-actions-button ui-layout-inline ui-layout-center ui-control-pointer ui-content-surface-muted ui-control-reset"
        :disabled="vm.joint.saving.value || vm.referenceChanging.value || vm.variantActionPending.value"
        @click="clearVariant"
      >
        <ImmersiveText text="清空装配" font="picker-title" ink-aligned />
      </button>
    </div>
    <aside v-if="current.wings.length" class="variant-wing-list">
      <ImmersiveText text="战机甲板" font="ship-title" />
      <div class="variant-wing-bays ui-layout-grid">
        <button
          v-for="wing in current.wings"
          :key="wing.index"
          class="variant-wing-tile ui-button ui-control-center ui-layout-clip ui-control-pointer ui-control-reset"
          :disabled="wing.builtin"
          :aria-label="wing.name + ' · 甲板 ' + (wing.index + 1)"
          @click="openWingPicker(wing.index, $event)"
        >
          <VariantWingIcon v-if="wing.id" :root="vm.joint.currentTarget.value!" :id="wing.id" :size="64" :renderer-size="72" />
          <img class="ui-image" v-else-if="deckIcon" :src="deckIcon" width="64" height="64" alt="空甲板" />
          <ImmersiveFallbackIcon v-else kind="fighter" :size="64" label="空甲板" />
          <strong class="variant-wing-tile-value" v-if="wing.id && !wing.builtin"
            ><ImmersiveText :text="formatVariantNumber(wing.cost)" font="heading"
          /></strong>
        </button>
      </div>
    </aside>
    <VariantRefitStats
      v-if="picker?.kind !== 'hullmods'"
      ref="refitStats"
      :variant="current"
      :vm="vm"
      :render="render"
      :picker-open="false"
      @step="step"
      @mod="changeMod"
      @picker="picker ? closePicker() : openPicker('hullmods', 0)"
    />
    <VariantPicker
      v-if="picker && picker.kind !== 'hullmods'"
      ref="candidatePicker"
      :root="vm.joint.currentTarget.value!"
      :kind="picker.kind"
      :weapon-slot="picker.kind === 'weapons' ? current.weapons[picker.index]!.slot : undefined"
      :current-id="currentId"
      :anchor="picker.anchor"
      :commit-manual="(id) => applySelection(id, 'normal', true)"
      @select="applySelection"
      @close="closePicker"
    />
    <n-modal
      v-if="picker?.kind === 'hullmods'"
      :show="true"
      :mask-closable="false"
      :mask-props="{ class: 'variant-modal-mask' }"
      :auto-focus="false"
      :close-on-esc="false"
      @update:show="closePicker"
    >
      <VariantHullmodPicker
        :root="vm.joint.currentTarget.value!"
        :variant="current"
        @select="applySelection"
        @manual-commit="applyManualSelection"
        @close="closeHullmods"
      >
        <template #stats="{ close }"
          ><VariantRefitStats
            :variant="current"
            :vm="vm"
            :render="render"
            :picker-open="true"
            @step="step"
            @mod="changeMod"
            @picker="close"
        /></template>
      </VariantHullmodPicker>
    </n-modal>
    <n-modal
      v-if="groupsOpen"
      :show="true"
      :mask-closable="false"
      :mask-props="{ class: 'variant-modal-mask' }"
      :auto-focus="false"
      :close-on-esc="false"
      class="variant-groups-modal"
      @update:show="groupsOpen = $event"
    >
      <VariantWeaponGroups :record-key="current.key" :variant="current" :vm="vm" :render="render" @close="closeGroups" />
    </n-modal>
  </div>
  <div v-else class="immersive-status">
    <ImmersiveText text="装配舰体来源缺失，请在主窗口配置表单维护舰体或 Skin 引用。" block />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import type { VariantPanel } from '@/domain/immersive/variant/variant-panel';
import { formatVariantNumber } from '@/domain/immersive/variant/variant-panel';
import { equipVariantWing, setVariantHullmod, type HullmodCategory } from '@/domain/immersive/variant/variant-actions';
import type { JointVariantCatalogKind } from '@/shared/types';
import type { useImmersiveVariantEditor } from '@/app/composables/immersive-editor/variant/use-immersive-variant-editor';
import { schemaStringValue } from '@/domain/schema/schema-values';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersivePanelRow from '../ImmersivePanelRow.vue';
import ImmersiveHullScene from '../ImmersiveHullScene.vue';
import VariantPicker from './VariantPicker.vue';
import VariantHullmodPicker from './VariantHullmodPicker.vue';
import VariantWeaponGroups from './VariantWeaponGroups.vue';
import VariantRefitStats from './VariantRefitStats.vue';
import VariantWingIcon from './VariantWingIcon.vue';
import { useVariantCatalog } from '@/app/composables/immersive-editor/variant/use-variant-catalog';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import ImmersiveFallbackIcon from '../ImmersiveFallbackIcon.vue';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
const props = defineProps<{ panel: VariantPanel; render: ImmersiveRenderContext; vm: ReturnType<typeof useImmersiveVariantEditor> }>();
for (const kind of ['weapons', 'wings', 'hullmods'] as const) {
  useVariantCatalog(
    () => props.vm.joint.currentTarget.value!,
    () => kind,
    () => Boolean(props.vm.joint.currentTarget.value),
  );
}
const selectedKey = ref(''),
  groupsButton = ref<HTMLButtonElement | null>(null),
  refitStats = ref<{ focusPicker: () => void } | null>(null),
  scene = ref<{ fit: () => void } | null>(null),
  candidatePicker = ref<InstanceType<typeof VariantPicker> | null>(null),
  picker = ref<{ kind: JointVariantCatalogKind; index: number; key: string; anchor: { x: number; y: number } } | null>(null),
  groupsOpen = ref(false);
const current = computed(
  () => props.panel.variants.find((variant) => variant.key === selectedKey.value) ?? props.panel.variants[0] ?? null,
);
const deckMedia = useResourceMediaRegistry({ surface: '空甲板', onError: useAppFeedback().error, onFailures: () => undefined });
const deckRef = computed(() => props.vm.displaySnapshot.value?.referenceSettings.resources.fighterButtonBlank);
const deckIcon = computed(() =>
  deckRef.value ? (deckMedia.dataUrl(props.vm.joint.currentTarget.value!.sessionId, deckRef.value) ?? '') : '',
);
watch(
  () => [props.vm.joint.currentTarget.value!.sessionId, current.value?.wings.some((wing) => !wing.id) ? deckRef.value : undefined] as const,
  ([session, resource]) => {
    void deckMedia.replaceCollection(session, 'empty-decks', resource ? [resource] : []);
  },
  { immediate: true },
);
const moduleOptions = computed(() =>
  props.panel.variants.map((variant, index) => ({ label: (index ? '模块 · ' : '主舰 · ') + variant.name, value: variant.key })),
);
const categoryLabel = (category: string) =>
  (({ normal: '普通', permanent: '永久', s: 'S 插件', builtin: '内置' }) as Record<string, string>)[category]!;
const installed = (id: string) => {
  const mod = current.value?.mods.find((item) => item.id === id);
  return mod ? categoryLabel(mod.category) : '';
};
const currentId = computed(() =>
  !picker.value || !current.value
    ? ''
    : picker.value.kind === 'weapons'
      ? current.value.weapons[picker.value.index]!.id
      : picker.value.kind === 'wings'
        ? current.value.wings[picker.value.index]!.id
        : '',
);
async function openPicker(kind: JointVariantCatalogKind, index: number, anchor = { x: 7, y: 207 }) {
  if (!current.value) return;
  if (!(await props.vm.commitVariantInputs())) return;
  if (kind === 'weapons' && current.value.weapons[index]!.builtin) return;
  if (
    kind === 'weapons' &&
    ['SYSTEM', 'DECORATIVE', 'LAUNCH_BAY', 'STATION_MODULE'].includes(schemaStringValue(current.value.weapons[index]!.slot.type))
  )
    return;
  if (!current.value.editable) {
    await props.vm.createOverrides([current.value.key]);
    return;
  }
  picker.value = { kind, index, key: current.value.key, anchor };
}
function openWeaponPicker(index: number, anchor: { x: number; y: number }) {
  void openPicker('weapons', index, anchor);
}
function openWingPicker(index: number, event: MouseEvent) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  void openPicker('wings', index, { x: bounds.right, y: bounds.top + bounds.height / 2 });
}
function closePicker() {
  props.vm.cancelVariantAction();
  const wasHullmod = picker.value?.kind === 'hullmods';
  picker.value = null;
  if (wasHullmod) void nextTick(() => refitStats.value?.focusPicker());
}
async function closeHullmods() {
  if (!(await props.vm.commitVariantInputs())) return false;
  props.vm.dismissStat();
  closePicker();
  return true;
}
async function applySelection(id: string, category: HullmodCategory, inputCommitted = false) {
  const request = picker.value!;
  const variant = props.panel.variants.find((item) => item.key === request.key)!;
  const accepted =
    request.kind === 'weapons'
      ? await props.vm.installVariantWeapon(request.key, schemaStringValue(variant.weapons[request.index]!.slot.id), id, inputCommitted)
      : await props.vm.updateVariant(request.key, (data) =>
          request.kind === 'wings'
            ? equipVariantWing(data, request.index, id)
            : setVariantHullmod(data, id, installed(id) ? null : category),
        );
  if (accepted && request.kind !== 'hullmods' && picker.value === request) closePicker();
  return accepted;
}
function applyManualSelection(id: string, category: HullmodCategory) {
  const request = picker.value!;
  props.vm.applyVariantAction(request.key, (data) => setVariantHullmod(data, id, category));
  if (request.kind !== 'hullmods') closePicker();
}
function changeMod(id: string, category: HullmodCategory | null) {
  const key = current.value!.key;
  void props.vm.updateVariant(key, (data) => setVariantHullmod(data, id, category));
}
function step(field: string, delta: number) {
  const key = current.value!.key;
  void props.vm.updateVariant(key, (data) => ({ ...data, [field]: Number(data[field] ?? 0) + delta }));
}
async function selectModule(key: string) {
  if (!(await props.vm.commitVariantInputs())) return;
  props.vm.dismissStat();
  closePicker();
  groupsOpen.value = false;
  selectedKey.value = key;
}
async function openGroups() {
  if (await props.vm.commitVariantInputs()) {
    props.vm.dismissStat();
    groupsOpen.value = true;
  }
}
function closeGroups() {
  groupsOpen.value = false;
  void nextTick(() => groupsButton.value!.focus({ preventScroll: true }));
}
function clearVariant() {
  const key = current.value!.key;
  void props.vm.stripVariantBranch(key);
}
watch(
  () => current.value?.key,
  () => {
    props.vm.cancelVariantAction();
    picker.value = null;
    groupsOpen.value = false;
  },
);
watch(
  () => props.panel.variants,
  (next, previous) => {
    const role = previous?.find((variant) => variant.key === selectedKey.value)?.role;
    if (role) selectedKey.value = next.find((variant) => variant.role === role)?.key ?? '';
  },
  { flush: 'sync' },
);
watch(
  () => props.vm.joint.currentTarget.value,
  (target) => {
    if (!target) {
      closePicker();
      groupsOpen.value = false;
    }
  },
);
</script>
