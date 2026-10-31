import type { AppFeedback } from '@/shared/types';
import { dispatchWorkspaceHistoryCommand } from '@/orchestrators/workspace-history.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';

export function useMainWindowShortcuts(feedback: AppFeedback) {
  const saveCommand = useSaveCommandStore();
  useWindowShortcuts({
    commands: {
      save: () => saveCommand.dispatchSaveCommand(),
      undo: () => void dispatchWorkspaceHistoryCommand('undo', feedback),
      redo: () => void dispatchWorkspaceHistoryCommand('redo', feedback),
    },
  });
}
