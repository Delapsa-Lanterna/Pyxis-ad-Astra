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
import { openModFromOverview } from '@/orchestrators/directory-opening.orchestrator';

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
    confirmNavigation(() => {
      if (workspace.mods.get(modRoot)?.status === 'ready') workspaceNavigation.activateModTab(modRoot);
      else
        void openModFromOverview(modRoot, starsectorRoot)
          .then((outcome) => {
            if (outcome.type === 'mod-loaded') for (const warning of outcome.warnings) feedback.warning(warning);
          })
          .catch((error: unknown) => feedback.error(error, '打开原版失败'));
    });
  }

  function navigateToModOverview(modRoot: string): void {
    confirmNavigation(() => workspaceNavigation.navigateToModOverview(modRoot));
  }

  function navigateToModTable(modRoot: string, table: CsvTableKey): void {
    confirmNavigation(() => workspaceNavigation.navigateToModTable(modRoot, table));
  }

  function navigateToModFiles(modRoot: string): void {
    if (workspace.activeModRoot === modRoot && workspace.currentView === 'mod-files') return;
    confirmNavigation(() => workspaceNavigation.navigateToModFiles(modRoot));
  }

  function navigateToModFileHistory(modRoot: string): void {
    if (workspace.activeModRoot === modRoot && workspace.currentView === 'file-history') return;
    confirmNavigation(() => workspaceNavigation.navigateToModFileHistory(modRoot));
  }

  function navigateToModJson(modRoot: string, page: JsonEditorPageId): void {
    if (workspace.activeModRoot === modRoot && workspace.currentView === 'json-editor' && workspace.jsonPage === page) return;
    confirmNavigation(() => workspaceNavigation.navigateToModJson(modRoot, page));
  }

  function activateModTab(modRoot: string): void {
    if (workspace.activeModRoot === modRoot && workspace.isModView) return;
    confirmNavigation(() => workspaceNavigation.activateModTab(modRoot));
  }

  function showOverview(): void {
    confirmNavigation(() => workspace.showOverview());
  }

  function showSettings(): void {
    confirmNavigation(() => workspace.showSettings());
  }

  function showAbout(): void {
    confirmNavigation(() => workspace.showAbout());
  }

  function confirmNavigation(action: () => void) {
    debugLog('navigation.requested');
    const commands = useSaveCommandStore();
    const sequence = commands.beginTransition();
    const waiting = commands.waitForSaves();
    if (waiting) {
      void waiting.then((saved) => {
        debugLog('navigation.save_settled', () => ({ saved: String(saved) }));
        if (saved && commands.isTransitionCurrent(sequence)) confirmIdleNavigation(action, sequence);
      });
      return;
    }
    confirmIdleNavigation(action, sequence);
  }

  function confirmIdleNavigation(action: () => void, sequence: number) {
    const modRoot = workspace.activeModRoot;
    const inputs = modRoot && workspace.currentView === 'table' ? tables.activeEditor?.inputs : useJsonEditorStore().active?.inputs;
    if (inputs) {
      const pending = inputs.commit();
      if (pending) {
        void pending
          .then((accepted) => {
            if (accepted && workspace.activeModRoot === modRoot && useSaveCommandStore().isTransitionCurrent(sequence)) {
              debugLog('navigation.accepted');
              action();
            }
          })
          .catch((error: unknown) => feedback.error(error));
        return;
      }
    }
    debugLog('navigation.accepted');
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
