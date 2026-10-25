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
      @load-mod="actions.loadOverviewMod" /><SettingsPage v-else-if="workspace.currentView === 'settings'" /><AboutPage
      v-else-if="workspace.currentView === 'about'" /><ModFileBrowser
      v-else-if="workspace.currentView === 'mod-files' && workspace.activeManifest" /><CsvEditorWorkspace
      v-else-if="workspace.currentView === 'table' && workspace.activeManifest"
      v-model:detail-pane-expanded="detailPaneExpanded"
      :actions="csvActions" /><WorkspaceModOverview
      v-else-if="workspace.currentView === 'mod-overview' && workspace.activeManifest" /><WorkspaceFileHistory
      v-else-if="workspace.currentView === 'file-history' && workspace.activeManifest" />
    <section
      v-else-if="workspace.currentView !== 'json-editor' || !workspace.activeManifest"
      class="empty-state ui-content-scroll ui-text-normal ui-layout-grid"
    >
      <n-spin size="large" />
      <h1 class="page-title">正在加载 Mod</h1>
      <p class="ui-text-muted ui-text-reset ui-text-wrap">{{ loadingModLabel }}</p>
    </section>
    <JsonEditorWorkspace
  /></MainWindowFrame>
</template>

<script setup lang="ts">
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useCsvEditorActions } from '@/app/composables/csv-editor/use-csv-editor-actions';
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
import { debugLog } from '@/shared/runtime/app-log-queue';
import { setRuntimeErrorContext } from '@/app/runtime-error-monitor';

const OverviewPage = defineAsyncComponent(() => import('@/app/components/OverviewPage.vue'));
const SettingsPage = defineAsyncComponent(() => import('@/app/components/SettingsPage.vue'));
const AboutPage = defineAsyncComponent(() => import('@/app/components/AboutPage.vue'));
const CsvEditorWorkspace = defineAsyncComponent(() => import('@/app/components/csv-editor/CsvEditorWorkspace.vue'));
const ModFileBrowser = defineAsyncComponent(() => import('@/app/components/mod-file-browser/ModFileBrowser.vue'));
const WorkspaceModOverview = defineAsyncComponent(() => import('@/app/components/workspace/WorkspaceModOverview.vue'));
const WorkspaceFileHistory = defineAsyncComponent(() => import('@/app/components/file-history/WorkspaceFileHistory.vue'));
const JsonEditorWorkspace = defineAsyncComponent(() => import('@/app/components/json-editor/JsonEditorWorkspace.vue'));
const contentNavigation = createContentNavigation();
const detailPaneExpanded = ref(true);
provide(contentNavigationKey, contentNavigation);
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const project = useProjectStore();
const draftSessions = useDraftSessionsStore();
const feedback = useAppFeedback();
const actions = useWorkspaceShellActions(feedback);
const csvActions = useCsvEditorActions(feedback);
useWorkspaceShellLifecycle(feedback, csvActions.selectAssociatedSpecs);
const saveCommand = useSaveCommandStore();
useMainWindowShortcuts(feedback);
const hasUnsavedMainWindowChanges = computed(() => workspace.loadedModList.some((mod) => draftSessions.hasUnsavedWorkForMod(mod.modRoot)));
const releaseRuntimeErrorContext = setRuntimeErrorContext(() => ({
  page: workspace.currentView,
  jsonPage: workspace.currentView === 'json-editor' ? workspace.jsonPage : null,
  csvTab: workspace.currentView === 'table' ? useCsvEditorStore().currentTab : null,
  modRoot: workspace.activeModRoot,
  sessionId: workspace.activeSessionId,
  targetId: useJsonEditorStore().active?.target.value?.id ?? null,
  dirty: String(hasUnsavedMainWindowChanges.value),
  saving: String(saveCommand.hasPendingSave()),
}));
useContextMenuScope({
  identity: () => JSON.stringify([workspace.currentView, workspace.jsonPage, workspace.activeModRoot]),
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
const activeDocument = computed(() =>
  workspace.currentView === 'table'
    ? useCsvEditorStore().activeEditor
    : workspace.currentView === 'json-editor'
      ? useJsonEditorStore().active
      : null,
);
async function saveActiveDocument() {
  const document = activeDocument.value;
  if (!document) return;
  try {
    const result = await document.save();
    if (result.status === 'noop') feedback.info('没有需要保存的修改');
  } catch (error) {
    feedback.error(error, '保存文档失败');
  }
}
const loadingModLabel = computed(() => {
  const activeModRoot = workspace.activeModRoot;
  if (!activeModRoot) return '';
  return workspace.loadedModList.find((mod) => mod.modRoot === activeModRoot)?.displayName || activeModRoot;
});

watch(
  activeDocument,
  (active) => {
    if (active) {
      saveCommand.registerActiveSaveHandler(saveActiveDocument);
    } else {
      saveCommand.unregisterActiveSaveHandler(saveActiveDocument);
    }
  },
  { immediate: true },
);

watch(
  () => [workspace.currentView, workspace.jsonPage, workspace.activeModRoot, useCsvEditorStore().currentTab],
  (identity, previous) => {
    debugLog('page.entered', () => ({ identity: JSON.stringify(identity), previous: JSON.stringify(previous ?? []) }));
  },
  { immediate: true },
);

onUnmounted(() => {
  closeGuard.dispose();
  releaseRuntimeErrorContext();
  saveCommand.unregisterActiveSaveHandler(saveActiveDocument);
});

onMounted(() => {
  void closeGuard.install();
});
</script>
