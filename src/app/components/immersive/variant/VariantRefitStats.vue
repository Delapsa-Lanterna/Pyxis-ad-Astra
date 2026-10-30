<template>
  <aside ref="surface" class="variant-refit-stats" @scroll.capture="hover.locate">
    <div class="variant-op-display ui-layout-row ui-layout-center">
      <VariantShipInfo
        :variant="variant"
        :snapshot="vm.displaySnapshot.value!"
        :values="vm.displayValues.value"
        :root="vm.joint.currentTarget.value!"
      />
      <div class="variant-op-budget ui-control-center" title="已使用／总装配点数 · 基础配置口径">
        <div class="variant-op-fill ui-layout-row" aria-hidden="true">
          <span :style="{ width: opSegments.within * 100 + '%', background: VARIANT_COLORS.opGradient }" />
          <span :style="{ width: opSegments.overflow * 100 + '%', background: VARIANT_COLORS.opOverflow }" />
        </div>
        <ImmersiveText
          :text="formatVariantNumber(variant.opUsed) + ' / ' + formatVariantNumber(variant.opTotal)"
          font="ship-title"
          ink-aligned
          outlined
        />
      </div>
    </div>
    <div class="variant-stat-stack">
      <div class="variant-base-stats ui-layout-grid">
        <div
          v-for="stat in variant.stats.slice(0, 3)"
          :key="stat.id"
          class="variant-stat-cell ui-layout-row ui-layout-stack"
          :title="stat.formula"
        >
          <ImmersiveText :text="stat.label" font="caption" /><ImmersiveText
            :text="stat.display"
            :runs="stat.displayRuns"
            font="ship-title"
          />
        </div>
      </div>
      <div v-for="(field, index) in ['fluxCapacitors', 'fluxVents']" :key="field" class="variant-flux-row ui-layout-row">
        <div class="variant-flux-controls ui-layout-row ui-layout-center">
          <ImmersiveText :text="index ? '耗散通道' : '幅能寄存器'" font="ship-title" ink-aligned />
          <button
            class="variant-step ui-button ui-control-center ui-control-pointer ui-control-reset ui-content-surface-muted"
            :disabled="!variant.editable || (index ? variant.vents : variant.capacitors) <= 0"
            :aria-label="index ? '减少耗散通道' : '减少幅能寄存器'"
            @click="$emit('step', field, -1)"
          >
            <ImmersiveText text="−" font="op" />
          </button>
          <ImmersivePanelRow :stat="variant.fields[index + 2]!" :render="render" />
          <button
            class="variant-step ui-button ui-control-center ui-control-pointer ui-control-reset ui-content-surface-muted"
            :disabled="!variant.editable"
            :aria-label="index ? '增加耗散通道' : '增加幅能寄存器'"
            @click="$emit('step', field, 1)"
          >
            <ImmersiveText text="+" font="op" />
          </button>
        </div>
        <div class="variant-stat-cell ui-layout-row ui-layout-stack">
          <ImmersiveText :text="index ? '幅能耗散' : '幅能容量'" font="caption" />
          <ImmersiveText
            :text="formatVariantNumber(index ? variant.dissipation : variant.capacity)"
            :runs="[
              {
                text: formatVariantNumber(index ? variant.dissipation : variant.capacity),
                color: (index ? variant.vents : variant.capacitors) > 0 ? VARIANT_COLORS.positive : VARIANT_COLORS.value,
              },
            ]"
            font="ship-title"
          />
        </div>
      </div>
      <div class="variant-defense-stats ui-layout-grid">
        <div
          v-for="stat in variant.stats.slice(5)"
          :key="stat.id"
          class="variant-stat-cell variant-defense-stats-content ui-layout-row ui-layout-stack"
          :title="stat.formula"
        >
          <ImmersiveText :text="stat.label" font="caption" /><ImmersiveText
            :text="stat.display"
            :runs="stat.displayRuns"
            font="ship-title"
          />
        </div>
      </div>
    </div>
    <section class="variant-mod-widget">
      <ImmersiveText text="船体插件" font="ship-title" />
      <div class="variant-mod-list">
        <div
          v-for="mod in variant.mods"
          :key="mod.id"
          :ref="media.mediaRef(mod.id, mod.icon)"
          class="variant-mod-row ui-layout-row ui-layout-center"
        >
          <n-popover
            trigger="click"
            placement="bottom-end"
            :disabled="blocked || !variant.editable"
            :show-arrow="false"
            :to="surface?.closest<HTMLElement>('[role=dialog]') ?? undefined"
          >
            <template #trigger
              ><button
                class="variant-mod-name ui-button ui-control-row ui-control-button ui-text-normal ui-layout-clip ui-control-reset"
                @focus="showDetails(mod.id, $event)"
                @blur="hover.leave"
                @click="hover.close()"
                @keydown.esc.stop.prevent="hover.close(true)"
              >
                <ImmersiveText
                  class="variant-mod-name-label"
                  @mouseenter="showDetails(mod.id, $event)"
                  @mouseleave="hover.leave"
                  :text="mod.name"
                  :runs="[{ text: mod.name, color: mod.category === 's' || mod.strengthened ? '#cc99ff' : undefined }]"
                  ink-aligned
                /></button
            ></template>
            <div class="variant-mod-edit">
              <ImmersiveText :text="mod.id + ' · ' + categoryLabel(mod.category) + (mod.strengthened ? ' · S 强化效果' : '')" block />
              <n-select
                :virtual-scroll="false"
                v-if="mod.category !== 'builtin'"
                :value="mod.category"
                :options="categories"
                @update:value="$emit('mod', mod.id, $event)"
              />
            </div>
          </n-popover>
          <ImmersiveText
            v-if="mod.category === 'normal'"
            :text="formatVariantNumber(mod.cost)"
            :runs="[{ text: formatVariantNumber(mod.cost), color: VARIANT_COLORS.value }]"
            font="ship-title"
          />
          <button
            v-if="mod.category !== 'builtin'"
            class="variant-step ui-button ui-control-center ui-control-pointer ui-control-reset ui-content-surface-muted"
            :disabled="!variant.editable"
            :aria-label="'卸下 ' + mod.name"
            @click="$emit('mod', mod.id, null)"
          >
            <ImmersiveText text="−" font="refit-button" />
          </button>
          <span class="variant-mod-icon"
            ><ImmersiveHullmodIcon
              :session-id="vm.joint.currentTarget.value!.sessionId"
              :resource="mod.icon"
              :active="media.mediaVisible(mod.id)"
              :label="mod.name"
              :size="34"
          /></span>
        </div>
      </div>
      <button
        ref="pickerButton"
        class="variant-add-mod ui-button ui-layout-inline ui-layout-center ui-control-pointer ui-content-surface-muted ui-control-reset"
        :disabled="!variant.editable"
        @click="$emit('picker')"
      >
        <ImmersiveText :text="pickerOpen ? '返回' : '添加'" font="picker-title" ink-aligned />
      </button>
    </section>
  </aside>
  <Teleport :to="surface?.closest<HTMLElement>('[role=dialog]') ?? 'body'">
    <div
      v-if="selected && catalog"
      :ref="(element) => (hover.surface.value = element as HTMLElement | null)"
      class="variant-hullmod-tooltip"
      role="tooltip"
      :style="hover.position.value"
      @mouseenter="hover.keep"
      @mouseleave="hover.leave"
      @keydown.esc.stop.prevent="hover.close(true)"
    >
      <VariantHullmodDetails :entry="selected" :reference="catalog" :images="detailImages" />
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, inject, ref, onMounted, watch } from 'vue';
import { immersiveBlockedKey } from '../immersive-render-context';
import type { VariantProjection } from '@/domain/immersive/variant/variant-panel';
import { formatVariantNumber, variantOpSegments } from '@/domain/immersive/variant/variant-panel';
import { VARIANT_COLORS } from '@/domain/immersive/appearance';
import type { HullmodCategory } from '@/domain/immersive/variant/variant-actions';
import type { useImmersiveVariantEditor } from '@/app/composables/immersive-editor/variant/use-immersive-variant-editor';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersivePanelRow from '../ImmersivePanelRow.vue';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import VariantShipInfo from './VariantShipInfo.vue';
import ImmersiveHullmodIcon from './ImmersiveHullmodIcon.vue';
import VariantHullmodDetails from './VariantHullmodDetails.vue';
import { useImmersiveHover } from '@/app/composables/use-immersive-hover';
import { useVariantCatalog } from '@/app/composables/immersive-editor/variant/use-variant-catalog';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
const props = defineProps<{
  variant: VariantProjection;
  render: ImmersiveRenderContext;
  vm: ReturnType<typeof useImmersiveVariantEditor>;
  pickerOpen: boolean;
}>();
const pickerButton = ref<HTMLButtonElement | null>(null);
const blocked = inject(immersiveBlockedKey, ref(false));
const surface = ref<HTMLElement | null>(null);
const hover = useImmersiveHover<string>(
  () => 393,
  () => 'left',
);
const { entries, snapshot: catalog } = useVariantCatalog(
  () => props.vm.joint.currentTarget.value!,
  () => 'hullmods',
);
const selected = computed(() => entries.value.find((entry) => entry.id === hover.selected.value));
const detailsMedia = useResourceMediaRegistry({ onError: useAppFeedback().error, onFailures: () => undefined });
const detailResources = computed(() =>
  selected.value && catalog.value
    ? ['e', 'e_bot', 'e_top', 'w', 'w_bot', 'w_top'].flatMap((edge) => {
        const resource = catalog.value!.referenceSettings.resources['ui_border1b_' + edge];
        return resource ? [resource] : [];
      })
    : [],
);
watch(
  [() => props.vm.joint.currentTarget.value!.sessionId, detailResources],
  ([session, resources]) => {
    void detailsMedia.replaceCollection(session, 'installed-hullmod-details', resources);
  },
  { immediate: true },
);
const detailImages = computed(() =>
  Object.fromEntries(
    detailResources.value.map((resource) => [
      resource.key,
      detailsMedia.dataUrl(props.vm.joint.currentTarget.value!.sessionId, resource) ?? '',
    ]),
  ),
);
watch([() => props.variant.key, () => props.vm.joint.currentTarget.value], () => hover.close());
watch(
  () => props.variant.mods,
  (mods) => {
    if (!mods.some((mod) => mod.id === hover.selected.value)) hover.close();
  },
);
function showDetails(id: string, event: MouseEvent | FocusEvent) {
  hover.show(id, event.currentTarget as HTMLElement, event.type === 'focus' ? 'focus' : 'hover');
}
defineExpose({ focusPicker: () => pickerButton.value!.focus({ preventScroll: true }) });
const opSegments = computed(() => variantOpSegments(props.variant.opUsed, props.variant.opTotal));
defineEmits<{ picker: []; step: [field: string, delta: number]; mod: [id: string, category: HullmodCategory | null] }>();
const media = useVisibleResourceMedia({
  thumbnailSize: 34,
  sessionId: () => props.vm.joint.currentTarget.value?.sessionId,
  surface: '装配插件',
  failureLabel: '装配插件图标读取失败',
  onFailures: () => undefined,
});
onMounted(() => media.setMediaRoot(surface.value));
const categories = [
  { label: '普通', value: 'normal' },
  { label: '永久', value: 'permanent' },
  { label: 'S 插件', value: 's' },
];
const categoryLabel = (category: string) =>
  ({ normal: '普通', permanent: '永久', s: 'S 插件', builtin: '内置' })[category as HullmodCategory | 'builtin'];
</script>
