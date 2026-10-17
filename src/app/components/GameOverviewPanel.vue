<template>
  <section class="game-overview ui-layout-grid">
    <div class="game-overview-summary ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-center">
      <div class="game-overview-title ui-layout-grid ui-layout-shrink">
        <strong class="game-overview-summary-value ui-emphasis ui-text-truncate ui-layout-shrink ui-text-normal">{{
          overview.starsectorRoot
        }}</strong>
        <span class="game-overview-summary-label ui-text-truncate ui-layout-shrink ui-text-muted ui-text-small">{{
          overview.coreAvailable ? '原版数据可用' : '原版数据不可用'
        }}</span>
      </div>
      <div class="game-overview-actions action-group">
        <n-button size="small" @click="$emit('create-mod')">创建新 Mod</n-button>
        <n-button size="small" @click="$emit('refresh-workspace')">刷新工作区</n-button>
        <n-button size="small" secondary type="error" @click="$emit('close-workspace')">关闭工作区</n-button>
      </div>
    </div>

    <ModOpeningFailureList
      :failures="openingFailures"
      @edit-failure-file="$emit('edit-failure-file', $event)"
      @dismiss-failure="$emit('dismiss-failure', $event)"
    />

    <div v-if="overview.warnings.length > 0" class="game-warning-list ui-layout-grid">
      <div v-for="warning in overview.warnings" :key="warningKey(warning)" class="game-warning-item ui-layout-grid ui-layout-center">
        <div class="game-warning-content ui-layout-grid ui-layout-shrink">
          <strong class="game-warning-content-value ui-emphasis ui-text-wrap ui-text-small">{{ warningMessage(warning) }}</strong>
          <span class="game-warning-content-label ui-text-truncate ui-text-muted ui-layout-shrink">{{ warning.path }}</span>
        </div>
        <div class="game-overview-actions action-group">
          <n-button v-if="warning.editTarget" size="small" secondary type="warning" @click="$emit('edit-warning-file', warning)">
            打开文件
          </n-button>
          <n-button size="small" @click="$emit('dismiss-warning', warning)">关闭提示</n-button>
        </div>
      </div>
    </div>

    <div v-if="overview.mods.length === 0" class="game-overview-empty ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid">
      <h2 class="game-overview-empty-title ui-text-soft ui-text-reset ui-text-normal ui-text-small">没有发现可识别 Mod</h2>
      <p class="game-overview-empty-description ui-text-muted ui-text-small ui-text-reset">
        已打开游戏目录，但 `mods` 目录下没有包含 `mod_info.json` 的 Mod。
      </p>
      <div class="game-overview-actions action-group">
        <n-button size="small" @click="$emit('create-mod')">创建新 Mod</n-button>
        <n-button size="small" @click="$emit('refresh-workspace')">刷新工作区</n-button>
        <n-button size="small" secondary type="error" @click="$emit('close-workspace')">关闭工作区</n-button>
      </div>
    </div>

    <div v-else class="overview-grid ui-layout-grid">
      <div
        v-for="mod in overview.mods"
        :key="mod.modRoot"
        class="overview-mod-card ui-layout-shrink ui-control-border ui-content-surface ui-content-column ui-control-pointer"
        :class="{ 'card-active': workspace.isModView && workspace.activeModRoot === mod.modRoot }"
      >
        <div class="mod-card-header ui-layout-row ui-layout-center">
          <strong class="mod-card-header-value ui-emphasis ui-text-truncate ui-text-small ui-layout-shrink">{{ mod.name }}</strong>
          <span class="mod-card-status ui-text-path" :class="modStatus(mod.modRoot)">{{ statusText(mod.modRoot) }}</span>
        </div>
        <div class="mod-card-version ui-text-muted ui-text-small">{{ mod.version || '未声明版本' }}</div>
        <div class="mod-card-path ui-text-truncate ui-text-muted">{{ mod.modRoot }}</div>
        <div v-if="mod.description" class="mod-card-description ui-text-body ui-text-soft ui-layout-clip ui-text-small">
          {{ mod.description }}
        </div>
        <div class="mod-card-actions ui-layout-row">
          <n-button v-if="workspace.isModImported(mod.modRoot)" size="small" @click="navigateToModOverview(mod.modRoot)">进入编辑</n-button>
          <n-button v-else size="small" type="primary" @click="$emit('load-mod', mod.modRoot)">打开</n-button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import ModOpeningFailureList from '@/app/components/ModOpeningFailureList.vue';
import type { GameOverviewData, GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { modStatusLabel } from '@/domain/workspace/mod-status';
import { appendFileReferenceLocation, extractFileReferenceFromError, formatError } from '@/shared/lib/errors';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';

defineProps<{ openingFailures: ModOpeningFailure[]; overview: GameOverviewData }>();
defineEmits<{
  'create-mod': [];
  'refresh-workspace': [];
  'close-workspace': [];
  'edit-warning-file': [warning: GameScanWarning];
  'edit-failure-file': [failure: ModOpeningFailure];
  'dismiss-failure': [modRoot: string];
  'dismiss-warning': [warning: GameScanWarning];
  'load-mod': [modRoot: string];
}>();

const workspace = useWorkspaceStore();
const { navigateToModOverview } = useWorkspaceNavigationActions();

function modStatus(modRoot: string): string {
  return workspace.mods.get(modRoot)?.status ?? 'pending';
}

function statusText(modRoot: string): string {
  const status = workspace.mods.get(modRoot)?.status;
  return status ? modStatusLabel(status) : '未读取';
}

function warningKey(warning: GameScanWarning): string {
  return JSON.stringify([warning.path, warning.message]);
}

function warningMessage(warning: GameScanWarning): string {
  return appendFileReferenceLocation(formatError(warning), extractFileReferenceFromError(warning));
}
</script>
