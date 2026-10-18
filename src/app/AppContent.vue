<template>
  <MainWindowFrame
    :navigation-visible="workspace.isModView"
    :narrow="contentNavigation.state.narrow"
    :navigation-expanded="contentNavigation.state.wideExpanded"
    :data-theme="settings.theme"
    ><template #titlebar><TitleBar /></template><template #tabs><ModTabsBar @remove-mod="actions.confirmRemoveMod" /></template
    ><template #navigation><ModNavigation /></template><template #notice><WriteSyncNotice /></template
    ><OverviewPage
      v-if="workspace.currentView === 'overview'"
      @import-mod="actions.openDirectory"
      @refresh-workspace="actions.refreshWorkspace"
      @close-workspace="actions.confirmCloseWorkspace"
      @edit-warning-file="actions.openGameWarningFile"
      @edit-failure-file="actions.openModOpeningFailureFile"
      @load-mod="actions.loadOverviewMod"
    /><SettingsPage
      v-else-if="workspace.currentView === 'settings'"
      :close-workspace="() => actions.confirmCloseWorkspace(false)"
    /><AboutPage v-else-if="workspace.currentView === 'about'" /><ModFileBrowser
      v-else-if="workspace.currentView === 'mod-files' && workspace.activeManifest"
    /><TableWorkspace
      v-else-if="workspace.currentView === 'table' && workspace.activeManifest"
      v-model:detail-pane-expanded="detailPaneExpanded"
    /><ConfigWorkspace v-else-if="workspace.currentView === 'config' && workspace.activeManifest" />
    <section v-else class="empty-state ui-content-scroll ui-text-normal ui-layout-grid">
      <n-spin size="large" />
      <h1 class="page-title">正在加载 Mod</h1>
      <p class="ui-text-muted ui-text-reset ui-text-wrap">{{ loadingModLabel }}</p>
    </section></MainWindowFrame
  >
</template>

<script setup lang="ts">
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { createContentNavigation, contentNavigationKey } from '@/app/composables/use-content-navigation';
import MainWindowFrame from '@/app/components/MainWindowFrame.vue';
import TitleBar from '@/app/TitleBar.vue';
import WriteSyncNotice from '@/app/components/WriteSyncNotice.vue';
import ModNavigation from '@/app/components/ModNavigation.vue';
import ModTabsBar from '@/app/components/ModTabsBar.vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWorkspaceShellActions } from '@/app/composables/use-workspace-shell-actions';
import { useWorkspaceShellLifecycle } from '@/app/composables/use-workspace-shell-lifecycle';
import { useMainWindowShortcuts } from '@/app/composables/use-main-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useProjectStore } from '@/stores/project.store';

const OverviewPage = defineAsyncComponent(() => import('@/app/components/OverviewPage.vue'));
const SettingsPage = defineAsyncComponent(() => import('@/app/components/SettingsPage.vue'));
const AboutPage = defineAsyncComponent(() => import('@/app/components/AboutPage.vue'));
const TableWorkspace = defineAsyncComponent(() => import('@/app/components/TableWorkspace.vue'));
const ModFileBrowser = defineAsyncComponent(() => import('@/app/components/mod-file-browser/ModFileBrowser.vue'));
const ConfigWorkspace = defineAsyncComponent(() => import('@/app/components/config/ConfigWorkspace.vue'));
const contentNavigation = createContentNavigation();
const detailPaneExpanded = ref(true);
provide(contentNavigationKey, contentNavigation);
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const project = useProjectStore();
const draftSessions = useDraftSessionsStore();
const feedback = useAppFeedback();
const actions = useWorkspaceShellActions(feedback);
useWorkspaceShellLifecycle(feedback, actions.selectAssociatedSpecs);
const saveCommand = useSaveCommandStore();
useMainWindowShortcuts(feedback);
const hasUnsavedMainWindowChanges = computed(() => workspace.loadedModList.some((mod) => draftSessions.hasUnsavedWorkForMod(mod.modRoot)));
useContextMenuScope({
  identity: () => JSON.stringify([workspace.currentView, workspace.configView, workspace.activeModRoot]),
  canRefresh: () => actions.canRefreshOverview.value,
  refresh: () => (workspace.currentView === 'overview' ? actions.refreshWorkspace() : actions.refreshModOverview(workspace.activeModRoot!)),
});
const closeGuard = useDirtyWindowCloseGuard({
  settle: actions.settleDirectoryOpenings,
  dirtyForScope: (scope) =>
    scope.kind === 'sessions'
      ? [...project.manifests.values()].some(
          (manifest) => scope.sessionIds.includes(manifest.sessionId) && draftSessions.hasUnsavedWorkForMod(manifest.modRoot),
        )
      : hasUnsavedMainWindowChanges.value,
  content: '主窗口中仍有未保存修改，关闭后这些修改将丢失。',
  dirty: hasUnsavedMainWindowChanges,
  title: '放弃未保存修改并关闭？',
});
const isTableView = computed(() => workspace.currentView === 'table' && Boolean(workspace.activeManifest));
const loadingModLabel = computed(() => {
  const activeModRoot = workspace.activeModRoot;
  if (!activeModRoot) return '';
  return workspace.loadedModList.find((mod) => mod.modRoot === activeModRoot)?.displayName || activeModRoot;
});

// Registration follows the same onMounted/onUnmounted pattern as the config
// editors; the table-view condition is watched so the handler is swapped the
// moment the view changes.
watch(
  isTableView,
  (active) => {
    if (active) {
      saveCommand.registerActiveSaveHandler(actions.saveChanges);
    } else {
      saveCommand.unregisterActiveSaveHandler(actions.saveChanges);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  closeGuard.dispose();
  saveCommand.unregisterActiveSaveHandler(actions.saveChanges);
});

onMounted(() => {
  void closeGuard.install();
});
</script>
