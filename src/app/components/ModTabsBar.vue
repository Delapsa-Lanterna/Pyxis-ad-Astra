<template>
  <nav
    v-if="workspace.hasWorkspaceContext"
    class="mod-tabs-bar ui-control-row ui-content-surface-muted ui-layout-grid ui-layout-shrink"
    aria-label="已打开 Mod"
  >
    <button
      class="mod-tabs-overview ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-text-reset ui-text-soft ui-control-pointer ui-content-surface"
      :class="{ active: workspace.currentView === 'overview' }"
      type="button"
      title="打开工作区总览"
      aria-label="打开工作区总览"
      @click="navigation.showOverview()"
    >
      <svg class="mod-tabs-overview-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    <button
      v-if="coreModRoot"
      class="mod-tabs-overview ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-text-reset ui-text-soft ui-control-pointer ui-content-surface"
      :class="{ active: workspace.isModView && workspace.activeModRoot === coreModRoot }"
      :aria-pressed="workspace.isModView && workspace.activeModRoot === coreModRoot"
      type="button"
      title="打开原版"
      aria-label="打开原版"
      @click="navigation.openCore()"
    >
      <svg class="mod-tabs-overview-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </svg>
    </button>
    <div class="mod-tabs-list ui-control-row ui-layout-row ui-layout-shrink" role="tablist">
      <div
        v-for="mod in modTabs"
        :key="mod.modRoot"
        class="mod-tab ui-text-soft ui-layout-row ui-layout-center ui-text-normal ui-content-surface"
        :class="{ active: workspace.isModView && workspace.activeModRoot === mod.modRoot }"
        :title="mod.modRoot"
      >
        <button
          class="mod-tab-activate ui-button ui-control-row ui-control-button ui-control-pointer"
          role="tab"
          type="button"
          :aria-selected="workspace.isModView && workspace.activeModRoot === mod.modRoot"
          @click="navigation.activateModTab(mod.modRoot)"
        >
          <span class="mod-tab-name ui-text-truncate ui-layout-shrink ui-text-small">{{ mod.displayName }}</span>
          <span v-if="hasDirtyChanges(mod.modRoot)" class="mod-tab-dirty" title="有未保存修改" />
          <span v-else class="mod-tab-status" :class="mod.status" :title="modStatusLabel(mod.status)" />
          <span v-if="mod.status === 'error' && mod.error" class="mod-tab-error-label ui-text-truncate" :title="mod.error"> 读取失败 </span>
        </button>
        <button
          class="mod-tab-close ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-control-pointer"
          type="button"
          title="从工作区移除"
          @click.stop="$emit('remove-mod', mod.modRoot)"
        >
          <svg class="mod-tab-close-icon ui-control-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
      </div>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { pathBasename } from '@/shared/lib/paths';
import { modStatusLabel } from '@/domain/workspace/mod-status';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

defineEmits<{ 'remove-mod': [modRoot: string] }>();

const workspace = useWorkspaceStore();
const draftSessions = useDraftSessionsStore();
const navigation = useWorkspaceNavigationActions();
const { coreModRoot } = navigation;
const modTabs = computed(() => workspace.loadedModList.filter((mod) => pathBasename(mod.modRoot).toLowerCase() !== 'starsector-core'));

function hasDirtyChanges(modRoot: string): boolean {
  return draftSessions.hasUnsavedWorkForMod(modRoot);
}
</script>
