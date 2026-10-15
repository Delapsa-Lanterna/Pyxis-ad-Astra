<template>
  <div class="wing-immersive-panel">
    <div class="immersive-title-row"><ImmersivePanelRow :stat="panel.heading[0]!" :render="render" /></div>
    <ImmersivePanelRow :stat="panel.heading[1]!" :render="render" />
    <div class="ship-immersive-description"><ImmersivePanelRow :stat="description" :render="render" /></div>
    <section>
      <ImmersiveSection title="技术数据" />
      <div class="weapon-immersive-data">
        <div class="variant-wing-icon" :style="{ width: '80px', height: '80px' }" :title="layout.diagnostic">
          <ImmersiveHullScene
            v-if="panel.preview && !layout.diagnostic"
            :variant="panel.preview"
            :session-id="render.root.sessionId"
            :icon-size="80"
            :wing-layout="layout"
          />
        </div>
        <div><ImmersivePanelRow v-for="stat in panel.technical" :key="stat.id" :stat="stat" :render="render" /></div>
      </div>
    </section>
    <section class="ship-immersive-related">
      <ImmersivePanelRow :stat="panel.system" :render="render" />
      <p><ImmersiveText :runs="panel.systemRuns" block /></p>
      <div class="immersive-related-row">
        <span><ImmersiveText text="武装" /></span
        ><strong><ImmersiveText :text="panel.armaments" :runs="panel.armamentRuns.length ? panel.armamentRuns : undefined" /></strong>
      </div>
    </section>
    <section>
      <ImmersiveSection title="来源与补全" />
      <p class="immersive-source-note"><ImmersiveText :text="'联队 ID：' + render.root.id" block /></p>
      <ImmersivePanelRow v-for="stat in panel.sources" :key="stat.id" :stat="stat" :render="render" />
      <n-button
        v-if="render.mode === 'editable' && panel.defaultDescription"
        :disabled="render.editing.changing || !render.editing.editable(panel.defaultDescription)"
        @click="render.editing.update([{ field: panel.defaultDescription, update: { kind: 'remove' } }])"
        >使用 Skin 默认描述</n-button
      >
      <ImmersivePanelSources :render="render" per-record />
    </section>
  </div>
</template>
<script setup lang="ts">
import type { WingPanel } from '@/domain/immersive/wing/wing-panel';
import { computed } from 'vue';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import { descriptionForRender } from '../immersive-render-context';
import ImmersivePanelRow from '../ImmersivePanelRow.vue';
import ImmersiveSection from '../ImmersiveSection.vue';
import ImmersivePanelSources from '../ImmersivePanelSources.vue';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersiveHullScene from '../ImmersiveHullScene.vue';
import { immersiveWingLayout } from '@/domain/immersive/hull-scene';
const props = defineProps<{ panel: WingPanel; render: ImmersiveRenderContext }>();
const description = computed(() => descriptionForRender(props.panel.description, props.render.mode));
const layout = computed(() => immersiveWingLayout(props.panel.count, props.panel.formation, 80));
</script>
