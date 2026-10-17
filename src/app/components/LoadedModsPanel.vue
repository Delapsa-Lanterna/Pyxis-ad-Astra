<template>
  <section class="overview-grid ui-layout-grid">
    <div
      v-for="mod in workspace.loadedModList"
      :key="mod.modRoot"
      class="overview-mod-card ui-layout-shrink ui-control-border ui-content-surface ui-content-column ui-control-pointer"
      :class="{ 'card-active': workspace.isModView && workspace.activeModRoot === mod.modRoot }"
      @click="navigateToModOverview(mod.modRoot)"
    >
      <div class="mod-card-header ui-layout-row ui-layout-center">
        <strong class="mod-card-header-value ui-emphasis ui-text-truncate ui-text-small ui-layout-shrink">{{ mod.displayName }}</strong>
        <span class="mod-card-status ui-text-path" :class="mod.status">{{ modStatusLabel(mod.status) }}</span>
      </div>
      <div class="mod-card-version ui-text-muted ui-text-small">{{ mod.version || '未声明版本' }}</div>
      <div class="mod-card-path ui-text-truncate ui-text-muted">{{ mod.modRoot }}</div>
      <div v-if="draftSessions.hasUnsavedWorkForMod(mod.modRoot)" class="mod-card-dirty">有未保存修改</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { modStatusLabel } from '@/domain/workspace/mod-status';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';

const workspace = useWorkspaceStore();
const draftSessions = useDraftSessionsStore();
const { navigateToModOverview } = useWorkspaceNavigationActions();
</script>
