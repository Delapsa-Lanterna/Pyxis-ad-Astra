<template>
  <div class="weapon-immersive-panel">
    <div class="immersive-title-row"><ImmersivePanelRow :stat="panel.heading[0]!" :vm="vm" /></div>
    <ImmersivePanelRow :stat="panel.heading[1]!" :vm="vm" />
    <div class="ship-immersive-description"><ImmersivePanelRow :stat="panel.description" :vm="vm" /></div>
    <ImmersiveSourceNotice :records="vm.notices.value" :saving="vm.joint.saving.value" @create-overrides="vm.createOverrides" />
    <p v-if="panel.diagnostic" class="immersive-source-note"><ImmersiveText :text="panel.diagnostic" block /></p>
    <section>
      <ImmersiveSection title="主数据"><ImmersivePanelRow :stat="panel.primarySettings" :vm="vm" /></ImmersiveSection>
      <div class="weapon-immersive-data">
        <ImmersiveWeaponIcon
          :layers="panel.iconLayers"
          :url="vm.mediaUrl"
          :label="panel.heading[0]!.display"
          :mount-type="panel.mountType"
          :mount-size="panel.mountSize"
          :loaded-missile="panel.loadedMissile"
        />
        <div><ImmersivePanelRow v-for="stat in panel.primary" :key="stat.id" :stat="stat" :vm="vm" /></div>
      </div>
      <ImmersiveHighlightedText v-if="panel.customPrimary" :text="panel.customPrimary" :highlights="panel.customPrimaryHL" />
    </section>
    <section>
      <ImmersiveSection title="辅助数据"><ImmersivePanelRow :stat="panel.ancillarySettings" :vm="vm" /></ImmersiveSection>
      <div class="weapon-immersive-data">
        <div>
          <img v-if="vm.mediaUrl(panel.damageIcon)" class="immersive-damage-icon" :src="vm.mediaUrl(panel.damageIcon)" alt="伤害类型图标" />
          <ImmersiveText v-else text="伤害图标来源未提供" block />
        </div>
        <div>
          <template v-for="stat in panel.ancillary" :key="stat.id"
            ><ImmersivePanelRow :stat="stat" :vm="vm" />
            <p v-if="stat.id === 'damage-type'" class="immersive-damage-description"><ImmersiveText :text="panel.damageDescription" /></p
          ></template>
        </div>
      </div>
      <ImmersiveHighlightedText v-if="panel.customAncillary" :text="panel.customAncillary" :highlights="panel.customAncillaryHL" />
    </section>
    <section class="weapon-immersive-sources">
      <ImmersiveSection title="来源与分支"><ImmersivePanelRow :stat="panel.branch" :vm="vm" /></ImmersiveSection
      ><template v-if="panel.projectile"
        ><ImmersivePanelRow :stat="panel.projectile" :vm="vm" /><n-button :disabled="!projectileId" @click="vm.openProjectile"
          >弹体编辑器</n-button
        ></template
      >
    </section>
  </div>
</template>
<script setup lang="ts">
import type { WeaponPanel } from '@/domain/immersive/weapon-panel';
import type { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import ImmersivePanelRow from './ImmersivePanelRow.vue';
import ImmersiveSourceNotice from './ImmersiveSourceNotice.vue';
import ImmersiveHighlightedText from './ImmersiveHighlightedText.vue';
import ImmersiveWeaponIcon from './ImmersiveWeaponIcon.vue';
import ImmersiveSection from './ImmersiveSection.vue';
import ImmersiveText from './ImmersiveText.vue';
import { computed } from 'vue';
import { jointObject } from '@/domain/joint-edit';
import { schemaStringValue } from '@/domain/schema/schema-values';
const props = defineProps<{ panel: WeaponPanel; vm: ReturnType<typeof useImmersiveEditorViewModel> }>();
const projectileId = computed(() =>
  schemaStringValue(jointObject(props.vm.joint.draftValue.value[props.vm.snapshot.value!.bindings.spec!]).projectileSpecId),
);
</script>
