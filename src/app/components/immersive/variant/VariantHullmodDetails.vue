<template>
  <ImmersiveTooltipFrame class="variant-hullmod-details ui-text-normal" :images="images">
    <header class="variant-hullmod-details-heading"><ImmersiveText :text="entry.label" font="heading" outlined block /></header>
    <p class="variant-hullmod-details-description" v-if="design !== 'Common'">
      <ImmersiveText
        :runs="[
          { text: '设计类型：', color: '#afafaf' },
          { text: design, color: designTypeColor(reference, design) },
        ]"
        block
      />
    </p>
    <p class="variant-hullmod-details-description" v-for="(paragraph, index) in description" :key="index">
      <ImmersiveText :runs="paragraph.runs" block />
    </p>
    <p
      class="variant-hullmod-details-description"
      v-if="hullmodString(entry, 'desc') && hullmodString(entry, 'short') && hullmodString(entry, 'desc') !== hullmodString(entry, 'short')"
    >
      <ImmersiveText :runs="hullmodDescription(hullmodString(entry, 'short')).runs.map((run) => ({ ...run, color: '#afafaf' }))" block />
    </p>
    <section class="variant-hullmod-details-section" v-if="strengthening.length">
      <ImmersiveText text="S强化静态说明" font="heading" outlined block />
      <p class="variant-hullmod-details-description" v-for="(paragraph, index) in strengthening" :key="index">
        <ImmersiveText :runs="paragraph.runs" block />
      </p>
    </section>
  </ImmersiveTooltipFrame>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { ReadonlyVariantEntry, JointVariantCatalogRead, DeepReadonly } from '@/shared/types';
import { hullmodString, hullmodDesign, hullmodDescription } from '@/domain/immersive/variant/variant-hullmods';
import { designTypeColor } from '@/domain/immersive/design-type';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersiveTooltipFrame from '../ImmersiveTooltipFrame.vue';
const props = defineProps<{
  entry: ReadonlyVariantEntry;
  reference: DeepReadonly<Pick<JointVariantCatalogRead, 'referenceSettings'>>;
  images: Record<string, string>;
}>();
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
</script>
