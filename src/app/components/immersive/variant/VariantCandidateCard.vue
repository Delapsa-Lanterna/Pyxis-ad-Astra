<template>
  <button
    class="variant-candidate-card"
    :class="{ 'variant-current': current }"
    :title="cardDiagnostic || undefined"
    @click="$emit('select')"
    @mouseenter="$emit('hover', $event)"
    @focus="$emit('hover', $event)"
    @mouseleave="$emit('leave', $event)"
    @blur="$emit('leave', $event)"
  >
    <ImmersiveWeaponIcon
      v-if="kind === 'weapons' && visible"
      :session-id="root.sessionId"
      :layers="layers"
      :url="mediaUrl"
      :label="entry.label"
      :mount-type="String(spec.mountTypeOverride || spec.type || '')"
      :mount-size="String(spec.size ?? '')"
      :loaded-missile="loadedMissile"
    />
    <ImmersiveHullScene
      v-else-if="scene && visible && !wingLayout.diagnostic"
      :variant="scene"
      :session-id="root.sessionId"
      :icon-size="69"
      :wing-layout="wingLayout"
      :resource-url="mediaUrl"
    />
    <div v-else />
    <div class="variant-card-text">
      <ImmersiveText :text="entry.label" /><ImmersiveText
        :text="summary"
        :runs="[{ text: summary, color: '#ffd200' }]"
        block
      /><ImmersiveText v-if="current" text="点击卸下" font="caption" block /><ImmersiveText
        class="variant-card-origin"
        :text="entry.source.source === 'mod' ? '当前 Mod' : 'Core'"
        font="caption"
      />
    </div>
    <strong
      ><ImmersiveText
        :text="formatVariantNumber(cost)"
        :runs="[{ text: formatVariantNumber(cost), color: current ? '#9bff00' : '#ffd200' }]"
        font="op" /><ImmersiveText text="装配点" font="caption"
    /></strong>
  </button>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { JointVariantEntry, JointEditRoot, ResourceRef } from '@/shared/types';
import { formatVariantNumber } from '@/domain/immersive/variant/variant-panel';
import { immersiveCatalogScene } from '@/domain/immersive/hull-scene';
import { weaponImageLayers, weaponLoadedMissile } from '@/domain/editors/weapon-images';
import { immersiveWingLayout } from '@/domain/immersive/hull-scene';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { immersiveNumber } from '@/domain/immersive/fields';
import { WING_ROLE_LABELS } from '@/domain/immersive/wing/wing-panel';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersiveWeaponIcon from '../ImmersiveWeaponIcon.vue';
import ImmersiveHullScene from '../ImmersiveHullScene.vue';
const props = withDefaults(
  defineProps<{
    root: JointEditRoot;
    kind: 'weapons' | 'wings';
    entry: JointVariantEntry;
    cost: number;
    diagnostic: string;
    current?: boolean;
    inView?: boolean;
    mediaUrl: (resource: ResourceRef) => string;
  }>(),
  { inView: true },
);
defineEmits<{ select: []; hover: [event: MouseEvent | FocusEvent]; leave: [event: MouseEvent | FocusEvent] }>();
const visible = computed(() => props.inView);
const spec = computed(() => (isRowData(props.entry.spec) ? props.entry.spec : {}));
const data = computed(() => (isRowData(props.entry.data) ? props.entry.data : {}));
const layers = computed(() => weaponImageLayers(spec.value, props.entry.resourceRefs, 'turret'));
const loadedMissile = computed(() =>
  weaponLoadedMissile(
    spec.value,
    props.entry.projectile && isRowData(props.entry.projectile.data) ? props.entry.projectile.data : {},
    props.entry.projectile?.resourceRefs ?? {},
    'turret',
  ),
);
const scene = computed(() => (props.kind === 'wings' ? immersiveCatalogScene(props.entry) : null));
const wingLayout = computed(() =>
  immersiveWingLayout(immersiveNumber(data.value, 'num', NaN), schemaStringValue(data.value.formation), 72),
);
const cardDiagnostic = computed(
  () => props.diagnostic || (props.kind === 'wings' ? wingLayout.value.diagnostic || (!scene.value ? '联队装配／舰体来源缺失' : '') : ''),
);
const mediaUrl = (resource: ResourceRef) => props.mediaUrl(resource);
const summary = computed(() =>
  props.kind === 'weapons'
    ? [props.entry.primaryRole || '未提供', formatVariantNumber(immersiveNumber(data.value, 'range', 250))].join('，')
    : schemaStringValue(data.value['role desc']) ||
      WING_ROLE_LABELS[schemaStringValue(data.value.role)] ||
      schemaStringValue(data.value.role),
);
</script>
