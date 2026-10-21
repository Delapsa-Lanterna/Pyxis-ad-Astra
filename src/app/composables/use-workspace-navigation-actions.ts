import * as workspaceNavigation from '@/orchestrators/workspace-navigation.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import type { JsonEditorPageId, CsvTableKey } from '@/shared/types';

export function useWorkspaceNavigationActions() {
  const workspace = useWorkspaceStore();
  const tables = useCsvEditorStore();
  const feedback = useAppFeedback();

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
    const commands = useSaveCommandStore();
    const sequence = commands.beginTransition();
    const waiting = commands.waitForSaves();
    if (waiting) {
      void waiting.then((saved) => {
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
            if (accepted && workspace.activeModRoot === modRoot && useSaveCommandStore().isTransitionCurrent(sequence)) action();
          })
          .catch((error: unknown) => feedback.error(error));
        return;
      }
    }
    action();
  }

  return {
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
