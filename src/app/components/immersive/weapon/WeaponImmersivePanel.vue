<template>
  <div class="weapon-immersive-panel ui-layout-shrink ui-layout-stretch">
    <div class="immersive-title-row ui-layout-row"><ImmersivePanelRow :stat="panel.heading[0]!" :render="render" /></div>
    <ImmersivePanelRow :stat="panel.heading[1]!" :render="render" />
    <div class="ship-immersive-description"><ImmersivePanelRow :stat="description" :render="render" /></div>
    <ImmersivePanelSources :render="render" />
    <p v-if="panel.diagnostic" class="immersive-source-note ui-text-muted ui-text-wrap ui-text-reset">
      <ImmersiveText :text="panel.diagnostic" block />
    </p>
    <section class="weapon-immersive-panel-section ui-layout-shrink">
      <ImmersiveSection title="原始数据"
        ><ImmersivePanelRow v-if="render.mode === 'editable'" :stat="panel.primarySettings" :render="render"
      /></ImmersiveSection>
      <div class="weapon-immersive-data ui-layout-grid">
        <ImmersiveWeaponIcon
          :session-id="render.root.sessionId"
          :layers="panel.iconLayers"
          :url="render.mediaUrl"
          :label="panel.heading[0]!.display"
          :mount-type="panel.mountType"
          :mount-size="panel.mountSize"
          :loaded-missile="panel.loadedMissile"
        />
        <div class="weapon-immersive-data-content ui-layout-shrink">
          <ImmersivePanelRow v-for="stat in panel.primary" :key="stat.id" :stat="stat" :render="render" />
        </div>
      </div>
      <ImmersiveHighlightedText v-if="panel.customPrimary" :text="panel.customPrimary" :highlights="panel.customPrimaryHL" />
    </section>
    <section class="weapon-immersive-panel-section ui-layout-shrink">
      <ImmersiveSection title="辅助数据"
        ><ImmersivePanelRow v-if="render.mode === 'editable'" :stat="panel.ancillarySettings" :render="render"
      /></ImmersiveSection>
      <div class="weapon-immersive-data ui-layout-grid">
        <div class="weapon-immersive-data-content ui-layout-shrink">
          <img
            v-if="render.mediaUrl(panel.damageIcon)"
            class="immersive-damage-icon ui-image"
            :src="render.mediaUrl(panel.damageIcon)"
            alt="伤害类型图标"
          />
          <ImmersiveFallbackIcon v-else :kind="panel.damageType" :size="80" label="伤害类型图标" />
        </div>
        <div class="weapon-immersive-data-content ui-layout-shrink">
          <template v-for="stat in panel.ancillary" :key="stat.id"
            ><ImmersivePanelRow :stat="stat" :render="render" />
            <p v-if="stat.id === 'damage-type'" class="immersive-damage-description ui-text-small ui-text-reset">
              <ImmersiveText :text="panel.damageDescription" /></p
          ></template>
        </div>
      </div>
      <ImmersiveHighlightedText v-if="panel.customAncillary" :text="panel.customAncillary" :highlights="panel.customAncillaryHL" />
    </section>
    <section class="weapon-immersive-sources weapon-immersive-panel-section ui-layout-shrink">
      <ImmersiveSection title="来源与分支"><ImmersivePanelRow :stat="panel.branch" :render="render" /></ImmersiveSection
      ><template v-if="panel.projectile"
        ><ImmersivePanelRow :stat="panel.projectile" :render="render" /><n-button
          v-if="render.mode === 'editable'"
          :disabled="!projectileId"
          @click="$emit('open-projectile')"
          >弹体编辑器</n-button
        ></template
      >
    </section>
  </div>
</template>
<script setup lang="ts">
import type { WeaponPanel } from '@/domain/immersive/weapon/weapon-panel';
import type { ImmersiveRenderContext } from '../immersive-render-context';
import { descriptionForRender } from '../immersive-render-context';
import ImmersivePanelRow from '../ImmersivePanelRow.vue';
import ImmersivePanelSources from '../ImmersivePanelSources.vue';
import ImmersiveHighlightedText from '../ImmersiveHighlightedText.vue';
import ImmersiveWeaponIcon from '../ImmersiveWeaponIcon.vue';
import ImmersiveSection from '../ImmersiveSection.vue';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersiveFallbackIcon from '../ImmersiveFallbackIcon.vue';
import { computed } from 'vue';
import { jointObject } from '@/domain/joint-edit';
import { schemaStringValue } from '@/domain/schema/schema-values';
defineEmits<{ 'open-projectile': [] }>();
const props = defineProps<{ panel: WeaponPanel; render: ImmersiveRenderContext }>();
const description = computed(() => descriptionForRender(props.panel.description, props.render.mode));
const projectileId = computed(() =>
  props.render.mode === 'editable'
    ? schemaStringValue(jointObject(props.render.editing.values[props.render.editing.snapshot.bindings.spec!]).projectileSpecId)
    : '',
);
</script>
