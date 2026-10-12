<template>
  <div class="wing-immersive-panel">
    <div class="immersive-title-row"><ImmersivePanelRow :stat="panel.heading[0]!" :vm="vm" /></div>
    <ImmersivePanelRow :stat="panel.heading[1]!" :vm="vm" />
    <div class="ship-immersive-description"><ImmersivePanelRow :stat="panel.description" :vm="vm" /></div>
    <section>
      <ImmersiveSection title="技术数据" />
      <div class="weapon-immersive-data">
        <ImmersiveShipPreview :url="vm.mediaUrl(panel.sprite)" :label="panel.heading[0]!.display" hull-size="" :size="80" />
        <div><ImmersivePanelRow v-for="stat in panel.technical" :key="stat.id" :stat="stat" :vm="vm" /></div>
      </div>
    </section>
    <section class="ship-immersive-related">
      <ImmersivePanelRow :stat="panel.system" :vm="vm" />
      <p><ImmersiveText :runs="panel.systemRuns" block /></p>
      <div class="immersive-related-row">
        <span><ImmersiveText text="武装" /></span
        ><strong><ImmersiveText :text="panel.armaments" :runs="panel.armamentRuns.length ? panel.armamentRuns : undefined" /></strong>
      </div>
    </section>
    <section>
      <ImmersiveSection title="来源与补全" />
      <p class="immersive-source-note"><ImmersiveText :text="'联队 ID：' + vm.joint.currentTarget.value!.id" block /></p>
      <ImmersivePanelRow v-for="stat in panel.sources" :key="stat.id" :stat="stat" :vm="vm" />
      <n-button
        v-if="panel.defaultDescription"
        :disabled="vm.referenceChanging.value || !vm.editable(panel.defaultDescription)"
        @click="vm.updateFields([{ field: panel.defaultDescription, update: { kind: 'remove' } }])"
        >使用 Skin 默认描述</n-button
      >
      <ImmersiveSourceNotice
        :records="vm.notices.value"
        :saving="vm.joint.saving.value || vm.referenceChanging.value"
        per-record
        @create-overrides="vm.createOverrides"
        @create-source="vm.createMissingSource"
      />
    </section>
  </div>
</template>
<script setup lang="ts">
import type { WingPanel } from '@/domain/immersive/wing-panel';
import type { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import ImmersivePanelRow from './ImmersivePanelRow.vue';
import ImmersiveSection from './ImmersiveSection.vue';
import ImmersiveSourceNotice from './ImmersiveSourceNotice.vue';
import ImmersiveText from './ImmersiveText.vue';
import ImmersiveShipPreview from './ImmersiveShipPreview.vue';
defineProps<{ panel: WingPanel; vm: ReturnType<typeof useImmersiveEditorViewModel> }>();
</script>
