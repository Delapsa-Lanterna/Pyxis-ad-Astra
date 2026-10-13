<template>
  <ImmersiveTooltipFrame class="variant-hullmod-details" :images="images">
    <header><ImmersiveText :text="entry.label" font="heading" outlined block /></header>
    <p v-if="design !== 'Common'">
      <ImmersiveText
        :runs="[
          { text: '设计类型：', color: '#afafaf' },
          { text: design, color: designTypeColor(reference, design) },
        ]"
        block
      />
    </p>
    <p v-for="(paragraph, index) in description" :key="index"><ImmersiveText :runs="paragraph.runs" block /></p>
    <p
      v-if="hullmodString(entry, 'desc') && hullmodString(entry, 'short') && hullmodString(entry, 'desc') !== hullmodString(entry, 'short')"
    >
      <ImmersiveText :runs="hullmodDescription(hullmodString(entry, 'short')).runs" block />
    </p>
    <section v-if="strengthening.length">
      <ImmersiveText text="S强化静态说明" font="heading" outlined block />
      <p v-for="(paragraph, index) in strengthening" :key="index"><ImmersiveText :runs="paragraph.runs" block /></p>
    </section>
    <p>
      <ImmersiveText
        :text="status.label + ' · 当前舰级基础OP ' + (Number.isFinite(cost) ? cost : '来源未确定')"
        :runs="[{ text: status.label + ' · 当前舰级基础OP ' + (Number.isFinite(cost) ? cost : '来源未确定'), color: status.iconColor }]"
        block
      />
    </p>
    <p v-if="status.diagnostic">
      <ImmersiveText :text="status.diagnostic" :runs="[{ text: status.diagnostic, color: '#ff6400' }]" block />
    </p>
    <p v-if="parameters" class="variant-hullmod-script"><ImmersiveText text="脚本参数待解析；统计采用基础配置。" font="caption" block /></p>
    <details @toggle="$emit('resize')">
      <summary><ImmersiveText text="来源与原文" font="caption" /></summary>
      <ImmersiveText
        :text="entry.id + '\n' + entry.source.path + '\n脚本：' + (hullmodString(entry, 'script') || '未提供')"
        font="caption"
        block
      /><ImmersiveText :text="hullmodString(entry, 'desc') || hullmodString(entry, 'short')" font="caption" block />
    </details>
  </ImmersiveTooltipFrame>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { JointVariantEntry, JointVariantCatalogRead } from '@/shared/types';
import type { VariantHullmod } from '@/domain/immersive/variant-panel';
import { hullmodString, hullmodDesign, hullmodDescription, hullmodCost, hullmodRowState } from '@/domain/immersive/variant-hullmods';
import { designTypeColor } from '@/domain/immersive/design-type';
import ImmersiveText from './ImmersiveText.vue';
import ImmersiveTooltipFrame from './ImmersiveTooltipFrame.vue';
const props = defineProps<{
  entry: JointVariantEntry;
  reference: Pick<JointVariantCatalogRead, 'referenceSettings'>;
  installed?: VariantHullmod;
  hullSize: string;
  available: number;
  images: Record<string, string>;
}>();
defineEmits<{ resize: [] }>();
const design = computed(() => hullmodDesign(props.entry));
function paragraphs(text: string) {
  let index = 0;
  return text
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean)
    .map((raw) => {
      const value = hullmodDescription(raw, index);
      index = value.nextIndex;
      return value;
    });
}
const description = computed(() =>
  paragraphs(hullmodString(props.entry, 'desc') || hullmodString(props.entry, 'short') || '静态说明未提供'),
);
const strengthening = computed(() => paragraphs(hullmodString(props.entry, 'sModDesc')));
const parameters = computed(() => [...description.value, ...strengthening.value].reduce((sum, value) => sum + value.parameters, 0));
const cost = computed(() => hullmodCost(props.entry, props.hullSize));
const status = computed(() => hullmodRowState(props.entry, props.installed, props.hullSize, props.available));
</script>
