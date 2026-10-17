<template>
  <div v-if="render.mode === 'editable'" class="ship-immersive-header ui-layout-grid">
    <div>
      <div class="immersive-title-row ui-layout-row">
        <ImmersivePanelRow v-for="stat in panel.heading.slice(0, 2)" :key="stat.id" :stat="stat" :render="render" />
      </div>
      <ImmersivePanelRow :stat="panel.heading[2]!" :render="render" />
      <div class="ship-immersive-description"><ImmersivePanelRow :stat="panel.description" :render="render" /></div>
    </div>
    <ImmersiveShipPreview :url="render.mediaUrl(panel.sprite)" :label="panel.heading[0]!.display" :hull-size="panel.hullSize" />
  </div>
  <ImmersivePanelSources :render="render" />
  <template v-if="render.mode === 'editable'">
    <p v-for="note in panel.notes" :key="note" class="immersive-source-note ui-text-muted ui-text-wrap ui-text-reset">
      <ImmersiveText :text="note" block />
    </p>
  </template>
  <div class="ship-immersive-stats ui-layout-grid">
    <section class="ship-immersive-logistics ship-immersive-stats-section ui-layout-contained">
      <ImmersiveSection title="后勤数据" />
      <div class="ship-immersive-logistics-columns ui-layout-grid">
        <div class="ship-immersive-logistics-columns-content ui-layout-contained" v-for="(column, index) in panel.logistics" :key="index">
          <ImmersivePanelRow v-for="stat in column" :key="stat.id" :stat="stat" :render="render" />
        </div>
      </div>
    </section>
    <section class="ship-immersive-stats-section ui-layout-contained">
      <ImmersiveSection title="战斗性能" />
      <ImmersivePanelRow v-for="stat in panel.combat" :key="stat.id" :stat="stat" :render="render" />
    </section>
  </div>
  <section class="ship-immersive-related">
    <ImmersivePanelRow :stat="panel.system" :render="render" />
    <p class="ship-immersive-related-description ui-text-soft"><ImmersiveText :text="panel.systemDescription" block /></p>
    <div v-for="item in panel.equipment" :key="item.label" class="immersive-related-row ui-layout-grid">
      <span><ImmersiveText :text="item.label" /></span
      ><strong class="immersive-related-row-value ui-text-normal"><ImmersiveText :text="item.text" :runs="item.runs" /></strong>
    </div>
  </section>
</template>
<script setup lang="ts">
import type { ShipImmersivePanel } from '@/domain/immersive/ship/ship-panel';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import ImmersivePanelRow from '../ImmersivePanelRow.vue';
import ImmersivePanelSources from '../ImmersivePanelSources.vue';
import ImmersiveSection from '../ImmersiveSection.vue';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersiveShipPreview from './ImmersiveShipPreview.vue';
defineProps<{ panel: ShipImmersivePanel; render: ImmersiveRenderContext }>();
</script>
