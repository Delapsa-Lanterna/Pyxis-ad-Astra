<template>
  <div class="ship-immersive-header">
    <div>
      <div class="immersive-title-row">
        <ImmersivePanelRow v-for="stat in panel.heading.slice(0, 2)" :key="stat.id" :stat="stat" :render="render" />
      </div>
      <ImmersivePanelRow :stat="panel.heading[2]!" :render="render" />
      <div class="ship-immersive-description"><ImmersivePanelRow :stat="panel.description" :render="render" /></div>
    </div>
    <ImmersiveShipPreview :url="render.mediaUrl(panel.sprite)" :label="panel.heading[0]!.display" :hull-size="panel.hullSize" />
  </div>
  <ImmersivePanelSources :render="render" />
  <p v-for="note in panel.notes" :key="note" class="immersive-source-note"><ImmersiveText :text="note" block /></p>
  <div class="ship-immersive-stats">
    <section class="ship-immersive-logistics">
      <ImmersiveSection title="后勤数据" />
      <div class="ship-immersive-logistics-columns">
        <div v-for="(column, index) in panel.logistics" :key="index">
          <ImmersivePanelRow v-for="stat in column" :key="stat.id" :stat="stat" :render="render" />
        </div>
      </div>
    </section>
    <section>
      <ImmersiveSection title="战斗性能" />
      <ImmersivePanelRow v-for="stat in panel.combat" :key="stat.id" :stat="stat" :render="render" />
    </section>
  </div>
  <section class="ship-immersive-related">
    <ImmersivePanelRow :stat="panel.system" :render="render" />
    <p><ImmersiveText :text="panel.systemDescription" block /></p>
    <div v-for="item in panel.equipment" :key="item.label" class="immersive-related-row">
      <span><ImmersiveText :text="item.label" /></span><strong><ImmersiveText :text="item.text" :runs="item.runs" /></strong>
    </div>
  </section>
</template>
<script setup lang="ts">
import type { ShipImmersivePanel } from '@/domain/immersive/ship-panel';
import type { ImmersiveRenderContext } from './immersive-render-context';
import ImmersivePanelRow from './ImmersivePanelRow.vue';
import ImmersivePanelSources from './ImmersivePanelSources.vue';
import ImmersiveSection from './ImmersiveSection.vue';
import ImmersiveText from './ImmersiveText.vue';
import ImmersiveShipPreview from './ImmersiveShipPreview.vue';
defineProps<{ panel: ShipImmersivePanel; render: ImmersiveRenderContext }>();
</script>
