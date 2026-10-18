<template>
  <button
    class="variant-candidate-card ui-button ui-text-normal ui-layout-grid ui-control-pointer ui-control-border"
    :class="{ 'variant-current': current, 'variant-list-active': active }"
    :title="cardDiagnostic || undefined"
    @click="$emit('select')"
    @mouseenter="$emit('hover', $event)"
    @focus="$emit('hover', $event)"
    @mouseleave="$emit('leave', $event)"
    @blur="$emit('leave', $event)"
  >
    <ImmersiveWeaponIcon
      v-if="kind === 'weapons'"
      :session-id="root.sessionId"
      :layers="layers"
      :url="mediaUrl"
      :label="entry.label"
      :mount-type="String(spec.mountTypeOverride || spec.type || '')"
      :mount-size="String(spec.size ?? '')"
      :active="active"
      :loaded-missile="loadedMissile"
    />
    <ImmersiveHullThumbnail
      v-else-if="scene && !wingLayout.diagnostic"
      :variant="scene"
      :session-id="root.sessionId"
      :size="69"
      :wing-layout="wingLayout"
      :active="active"
      :resource-url="mediaUrl"
    />
    <div v-else />
    <div class="variant-card-text ui-layout-row ui-layout-shrink ui-layout-stack ui-layout-clip">
      <ImmersiveText :active="active" :text="entry.label" /><ImmersiveText
        :active="active"
        :text="summary"
        :runs="[{ text: summary, color: '#ffd200' }]"
        block
      /><ImmersiveText :active="active" v-if="current" text="点击卸下" font="caption" block /><ImmersiveText
        :active="active"
        class="variant-card-origin"
        :text="entry.source.source === 'mod' ? '当前 Mod' : 'Core'"
        font="caption"
      />
    </div>
    <strong class="variant-candidate-card-value ui-layout-row ui-layout-stack"
      ><ImmersiveText
        :active="active"
        :text="formatVariantNumber(cost)"
        :runs="[{ text: formatVariantNumber(cost), color: current ? '#9bff00' : '#ffd200' }]"
        font="op" /><ImmersiveText :active="active" text="装配点" font="caption"
    /></strong>
  </button>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { ReadonlyVariantEntry, JointEditRoot, ResourceRef } from '@/shared/types';
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
import ImmersiveHullThumbnail from '../ImmersiveHullThumbnail.vue';
const props = withDefaults(
  defineProps<{
    root: JointEditRoot;
    kind: 'weapons' | 'wings';
    entry: ReadonlyVariantEntry;
    cost: number;
    diagnostic: string;
    current?: boolean;
    active?: boolean;
    mediaUrl: (resource: ResourceRef) => string;
  }>(),
  { active: true },
);
defineEmits<{ select: []; hover: [event: MouseEvent | FocusEvent]; leave: [event: MouseEvent | FocusEvent] }>();
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
