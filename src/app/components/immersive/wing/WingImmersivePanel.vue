<template>
  <div class="wing-immersive-panel">
    <div class="immersive-title-row ui-layout-row"><ImmersivePanelRow :stat="panel.heading[0]!" :render="render" /></div>
    <ImmersivePanelRow :stat="panel.heading[1]!" :render="render" />
    <div class="ship-immersive-description"><ImmersivePanelRow :stat="description" :render="render" /></div>
    <section>
      <ImmersiveSection title="技术数据" />
      <div class="weapon-immersive-data ui-layout-grid">
        <div class="variant-wing-icon weapon-immersive-data-content ui-layout-shrink ui-layout-clip" :title="layout.diagnostic">
          <ImmersiveHullScene
            v-if="panel.preview && !layout.diagnostic"
            :variant="panel.preview"
            :session-id="render.root.sessionId"
            :icon-size="80"
            :wing-layout="layout"
          />
        </div>
        <div class="weapon-immersive-data-content ui-layout-shrink">
          <ImmersivePanelRow v-for="stat in panel.technical" :key="stat.id" :stat="stat" :render="render" />
        </div>
      </div>
    </section>
    <section class="ship-immersive-related">
      <ImmersivePanelRow :stat="panel.system" :render="render" />
      <p class="ship-immersive-related-description ui-text-soft"><ImmersiveText :runs="panel.systemRuns" block /></p>
      <div class="immersive-related-row ui-layout-grid">
        <span><ImmersiveText text="军备详情" /></span
        ><strong class="immersive-related-row-value ui-text-normal"
          ><ImmersiveText :text="panel.armaments" :runs="panel.armamentRuns.length ? panel.armamentRuns : undefined"
        /></strong>
      </div>
    </section>
    <section>
      <ImmersiveSection title="来源与补全" />
      <p class="immersive-source-note ui-text-muted ui-text-wrap ui-text-reset">
        <ImmersiveText :text="'战机联队 ID：' + render.root.id" block />
      </p>
      <ImmersivePanelRow v-for="stat in panel.sources" :key="stat.id" :stat="stat" :render="render" />
      <div v-if="render.mode === 'editable'" class="action-group">
        <n-button :disabled="!editorIds.ship" @click="$emit('open-editor', 'ship')">舰船沉浸式编辑器</n-button>
        <n-button :disabled="!editorIds.variant" @click="$emit('open-editor', 'variant')">装配沉浸式编辑器</n-button>
      </div>
      <n-button
        v-if="render.mode === 'editable' && panel.defaultDescription"
        :disabled="render.editing.changing || !render.editing.editable(panel.defaultDescription)"
        @click="render.editing.update([{ field: panel.defaultDescription, update: { kind: 'remove' } }])"
        >使用 Skin 默认描述</n-button
      >
      <ImmersivePanelSources :render="render" per-record @create-source="$emit('create-source', $event)" />
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
import { jointObject } from '@/domain/joint-edit';
import { schemaStringValue } from '@/domain/schema/schema-values';
const props = defineProps<{ panel: WingPanel; render: ImmersiveRenderContext }>();
defineEmits<{ 'create-source': [key: string]; 'open-editor': [kind: 'ship' | 'variant'] }>();
const description = computed(() => descriptionForRender(props.panel.description, props.render.mode));
const layout = computed(() => immersiveWingLayout(props.panel.count, props.panel.formation, 80));
const editorIds = computed(() => {
  if (props.render.mode === 'readonly') return { ship: '', variant: '' };
  const { snapshot, values } = props.render.editing;
  return {
    ship:
      snapshot.records.find((record) => record.key === snapshot.bindings.hull)?.value.state === 'present'
        ? schemaStringValue(jointObject(values[snapshot.bindings.variant!]).hullId)
        : '',
    variant: schemaStringValue(jointObject(values[snapshot.bindings.csv!]).variant),
  };
});
</script>
