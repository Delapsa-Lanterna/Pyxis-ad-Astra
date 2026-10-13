<template>
  <div class="weapon-immersive-panel">
    <div class="immersive-title-row"><ImmersivePanelRow :stat="panel.heading[0]!" :render="render" /></div>
    <ImmersivePanelRow :stat="panel.heading[1]!" :render="render" />
    <div class="ship-immersive-description"><ImmersivePanelRow :stat="panel.description" :render="render" /></div>
    <ImmersivePanelSources :render="render" />
    <p v-if="panel.diagnostic" class="immersive-source-note"><ImmersiveText :text="panel.diagnostic" block /></p>
    <section>
      <ImmersiveSection title="主数据"
        ><ImmersivePanelRow v-if="render.mode === 'editable'" :stat="panel.primarySettings" :render="render"
      /></ImmersiveSection>
      <div class="weapon-immersive-data">
        <ImmersiveWeaponIcon
          :layers="panel.iconLayers"
          :url="render.mediaUrl"
          :label="panel.heading[0]!.display"
          :mount-type="panel.mountType"
          :mount-size="panel.mountSize"
          :loaded-missile="panel.loadedMissile"
        />
        <div><ImmersivePanelRow v-for="stat in panel.primary" :key="stat.id" :stat="stat" :render="render" /></div>
      </div>
      <ImmersiveHighlightedText v-if="panel.customPrimary" :text="panel.customPrimary" :highlights="panel.customPrimaryHL" />
    </section>
    <section>
      <ImmersiveSection title="辅助数据"
        ><ImmersivePanelRow v-if="render.mode === 'editable'" :stat="panel.ancillarySettings" :render="render"
      /></ImmersiveSection>
      <div class="weapon-immersive-data">
        <div>
          <img
            v-if="render.mediaUrl(panel.damageIcon)"
            class="immersive-damage-icon"
            :src="render.mediaUrl(panel.damageIcon)"
            alt="伤害类型图标"
          />
          <ImmersiveText v-else text="伤害图标来源未提供" block />
        </div>
        <div>
          <template v-for="stat in panel.ancillary" :key="stat.id"
            ><ImmersivePanelRow :stat="stat" :render="render" />
            <p v-if="stat.id === 'damage-type'" class="immersive-damage-description"><ImmersiveText :text="panel.damageDescription" /></p
          ></template>
        </div>
      </div>
      <ImmersiveHighlightedText v-if="panel.customAncillary" :text="panel.customAncillary" :highlights="panel.customAncillaryHL" />
    </section>
    <section class="weapon-immersive-sources">
      <ImmersiveSection title="来源与分支"><ImmersivePanelRow :stat="panel.branch" :render="render" /></ImmersiveSection
      ><template v-if="panel.projectile"
        ><ImmersivePanelRow :stat="panel.projectile" :render="render" /><n-button
          v-if="render.mode === 'editable'"
          :disabled="!projectileId"
          @click="render.editing.openProjectile"
          >弹体编辑器</n-button
        ></template
      >
    </section>
  </div>
</template>
<script setup lang="ts">
import type { WeaponPanel } from '@/domain/immersive/weapon-panel';
import type { ImmersiveRenderContext } from './immersive-render-context';
import ImmersivePanelRow from './ImmersivePanelRow.vue';
import ImmersivePanelSources from './ImmersivePanelSources.vue';
import ImmersiveHighlightedText from './ImmersiveHighlightedText.vue';
import ImmersiveWeaponIcon from './ImmersiveWeaponIcon.vue';
import ImmersiveSection from './ImmersiveSection.vue';
import ImmersiveText from './ImmersiveText.vue';
import { computed } from 'vue';
import { jointObject } from '@/domain/joint-edit';
import { schemaStringValue } from '@/domain/schema/schema-values';
const props = defineProps<{ panel: WeaponPanel; render: ImmersiveRenderContext }>();
const projectileId = computed(() =>
  props.render.mode === 'editable'
    ? schemaStringValue(jointObject(props.render.editing.values[props.render.editing.snapshot.bindings.spec!]).projectileSpecId)
    : '',
);
</script>
