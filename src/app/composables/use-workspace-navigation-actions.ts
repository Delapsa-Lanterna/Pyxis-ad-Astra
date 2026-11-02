import * as workspaceNavigation from '@/orchestrators/workspace-navigation.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import type { JsonEditorPageId, CsvTableKey } from '@/shared/types';
import { debugLog } from '@/shared/runtime/app-log-queue';
import { computed } from 'vue';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { gameCoreDirectoryPath } from '@/shared/lib/paths';
import { openWorkspaceMod } from '@/orchestrators/workspace-opening.orchestrator';

export function useWorkspaceNavigationActions() {
  const workspace = useWorkspaceStore();
  const tables = useCsvEditorStore();
  const feedback = useAppFeedback();
  const core = useCoreAssetsStore();
  const coreModRoot = computed(() => {
    if (!core.root) return null;
    const manifest = workspace.activeManifest;
    const available =
      manifest?.starsectorRoot === core.root
        ? manifest.coreAvailable
        : workspace.gameOverview?.starsectorRoot === core.root
          ? workspace.gameOverview.coreAvailable
          : true;
    return available ? gameCoreDirectoryPath(core.root) : null;
  });

  function openCore(): void {
    const modRoot = coreModRoot.value!;
    const starsectorRoot = core.root;
    confirmNavigation(
      () => {
        if (workspace.mods.get(modRoot)?.status === 'ready') workspaceNavigation.activateModTab(modRoot);
        else
          void openWorkspaceMod(modRoot, starsectorRoot)
            .then((outcome) => {
              if (outcome.type === 'mod-loaded') for (const warning of outcome.warnings) feedback.warning(warning);
            })
            .catch((error: unknown) => feedback.error(error, '打开原版失败'));
      },
      { modRoot, page: 'core' },
    );
  }

  function navigateToModOverview(modRoot: string): void {
    confirmNavigation(() => workspaceNavigation.navigateToModOverview(modRoot), { modRoot, page: 'mod-overview' });
  }

  function navigateToModTable(modRoot: string, table: CsvTableKey): void {
    confirmNavigation(() => workspaceNavigation.navigateToModTable(modRoot, table), { modRoot, table, page: 'table' });
  }

  function navigateToModFiles(modRoot: string): void {
    if (workspace.activeModRoot === modRoot && workspace.currentView === 'mod-files') return;
    confirmNavigation(() => workspaceNavigation.navigateToModFiles(modRoot), { modRoot, page: 'mod-files' });
  }

  function navigateToModFileHistory(modRoot: string): void {
    if (workspace.activeModRoot === modRoot && workspace.currentView === 'file-history') return;
    confirmNavigation(() => workspaceNavigation.navigateToModFileHistory(modRoot), { modRoot, page: 'file-history' });
  }

  function navigateToModJson(modRoot: string, page: JsonEditorPageId): void {
    if (workspace.activeModRoot === modRoot && workspace.currentView === 'json-editor' && workspace.jsonPage === page) return;
    confirmNavigation(() => workspaceNavigation.navigateToModJson(modRoot, page), { modRoot, page });
  }

  function activateModTab(modRoot: string): void {
    if (workspace.activeModRoot === modRoot && workspace.isModView) return;
    confirmNavigation(() => workspaceNavigation.activateModTab(modRoot), { modRoot, page: 'activate-mod' });
  }

  function showOverview(): void {
    confirmNavigation(() => workspace.showOverview(), { page: 'overview' });
  }

  function showSettings(): void {
    confirmNavigation(() => workspace.showSettings(), { page: 'settings' });
  }

  function showAbout(): void {
    confirmNavigation(() => workspace.showAbout(), { page: 'about' });
  }

  function confirmNavigation(action: () => void, destination: Record<string, string>) {
    const commands = useSaveCommandStore();
    const sequence = commands.beginTransition();
    const fields = {
      request: String(sequence),
      fromPage: workspace.currentView,
      fromModRoot: workspace.activeModRoot ?? '',
      ...destination,
    };
    debugLog('navigation.requested', () => fields);
    const waiting = commands.waitForSaves();
    if (waiting) {
      void waiting.then((saved) => {
        debugLog('navigation.save_settled', () => ({ ...fields, saved: String(saved) }));
        if (saved && commands.isTransitionCurrent(sequence)) confirmIdleNavigation(action, sequence, fields);
      });
      return;
    }
    confirmIdleNavigation(action, sequence, fields);
  }

  function confirmIdleNavigation(action: () => void, sequence: number, fields: Record<string, string>) {
    const modRoot = workspace.activeModRoot;
    const target =
      modRoot && workspace.currentView === 'table'
        ? { sessionId: workspace.activeSessionId!, modRoot, table: tables.getCsvModState(modRoot)!.currentTab }
        : null;
    const inputs = target ? tables.getTableEditor(target).inputs : useJsonEditorStore().active?.inputs;
    if (inputs) {
      const pending = inputs.commit();
      if (pending) {
        void pending
          .then((accepted) => {
            if (
              accepted &&
              workspace.activeModRoot === modRoot &&
              (!target ||
                (workspace.activeSessionId === target.sessionId && tables.getCsvModState(target.modRoot)?.currentTab === target.table)) &&
              useSaveCommandStore().isTransitionCurrent(sequence)
            ) {
              debugLog('navigation.accepted', () => fields);
              action();
            }
          })
          .catch((error: unknown) => feedback.error(error));
        return;
      }
    }
    debugLog('navigation.accepted', () => fields);
    action();
  }

  return {
    coreModRoot,
    openCore,
    activateModTab,
    navigateToModFileHistory,
    navigateToModJson,
    navigateToModFiles,
    navigateToModOverview,
    navigateToModTable,
    showAbout,
    showOverview,
    showSettings,
  };
}
