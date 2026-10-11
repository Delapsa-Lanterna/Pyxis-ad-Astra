<template>
  <div class="ship-immersive-header">
    <div>
      <div class="immersive-title-row">
        <ImmersivePanelRow v-for="stat in panel.heading.slice(0, 2)" :key="stat.id" :stat="stat" :vm="vm" />
      </div>
      <ImmersivePanelRow :stat="panel.heading[2]!" :vm="vm" />
      <div class="ship-immersive-description"><ImmersivePanelRow :stat="panel.description" :vm="vm" /></div>
    </div>
    <ImmersiveShipPreview :url="vm.sprite.value" :label="panel.heading[0]!.display" :hull-size="panel.hullSize" />
  </div>
  <ImmersiveSourceNotice :records="vm.notices.value" :saving="vm.joint.saving.value" @create-overrides="vm.createOverrides" />
  <div class="ship-immersive-stats">
    <section class="ship-immersive-logistics">
      <ImmersiveSection title="后勤数据" />
      <div class="ship-immersive-logistics-columns">
        <div v-for="(column, index) in panel.logistics" :key="index">
          <ImmersivePanelRow v-for="stat in column" :key="stat.id" :stat="stat" :vm="vm" />
        </div>
      </div>
    </section>
    <section>
      <ImmersiveSection title="战斗性能" />
      <ImmersivePanelRow v-for="stat in panel.combat" :key="stat.id" :stat="stat" :vm="vm" />
    </section>
  </div>
  <section class="ship-immersive-related">
    <ImmersivePanelRow :stat="panel.system" :vm="vm" />
    <p><ImmersiveText :text="panel.systemDescription" block /></p>
    <div class="immersive-related-row">
      <span><ImmersiveText text="挂载" /></span
      ><strong><ImmersiveText :text="panel.mounts" :runs="panel.mountRuns.length ? panel.mountRuns : undefined" /></strong>
    </div>
    <div class="immersive-related-row">
      <span><ImmersiveText text="内置武装" /></span
      ><strong><ImmersiveText :text="panel.armaments" :runs="panel.armamentRuns.length ? panel.armamentRuns : undefined" /></strong>
    </div>
    <div class="immersive-related-row">
      <span><ImmersiveText text="内置插件" /></span><strong><ImmersiveText :text="panel.hullmods" /></strong>
    </div>
  </section>
</template>
<script setup lang="ts">
import type { ShipImmersivePanel } from '@/domain/immersive/ship-panel';
import type { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import ImmersivePanelRow from './ImmersivePanelRow.vue';
import ImmersiveSourceNotice from './ImmersiveSourceNotice.vue';
import ImmersiveSection from './ImmersiveSection.vue';
import ImmersiveText from './ImmersiveText.vue';
import ImmersiveShipPreview from './ImmersiveShipPreview.vue';
defineProps<{ panel: ShipImmersivePanel; vm: ReturnType<typeof useImmersiveEditorViewModel> }>();
</script>
