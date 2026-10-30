import { useSaveCommandStore } from '@/stores/save-command.store';
import { onMounted, onUnmounted, watch } from 'vue';
import { useWindowLifecycleActions } from './use-window-close-state';
import type { AppFeedback, AssociatedSpecChange } from '@/shared/types';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';
import { removeLoadedModRuntime } from '@/orchestrators/workspace-lifecycle.orchestrator';
import {
  restorePersistedWorkspace,
  watchWorkspacePersistence,
  type WorkspacePersistenceWatcher,
} from '@/orchestrators/workspace-persistence.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { recordLogBestEffort } from '@/services/app-log.service';
import { debugLog } from '@/shared/runtime/app-log-queue';
import { buildModOpeningFailure } from '@/domain/project/load-diagnostics';
import { useCsvSaveParticipants } from '@/app/composables/csv-editor/use-csv-save-participants';
import { publishReferenceSources } from '@/orchestrators/project-sync.orchestrator';
import { useProjectStore } from '@/stores/project.store';

// Main-window-only bootstrap: startup restore, workspace-state persistence and
// window save events run once per application shell, never per page component.
export function useWorkspaceShellLifecycle(
  feedback: AppFeedback,
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>,
) {
  useCsvSaveParticipants(feedback, selectAssociatedSpecs);
  const { requestClose } = useWindowLifecycleActions();
  const workspace = useWorkspaceStore();
  let workspacePersistence: WorkspacePersistenceWatcher | null = null;
  let disposed = false;
  let publishing = Promise.resolve();
  watch(
    () =>
      workspace.loadedModList
        .filter((mod) => workspace.referenceableModRoots.has(mod.modRoot))
        .map((mod) => ({ sessionId: useProjectStore().getSessionId(mod.modRoot)!, modRoot: mod.modRoot })),
    (sources, previous) => {
      if (sources.length === previous.length && sources.every((source, index) => source.sessionId === previous[index]!.sessionId)) return;
      publishing = publishing
        .then(() => (disposed ? undefined : publishReferenceSources(sources)))
        .catch((error) => feedback.error(error, '更新引用来源失败'));
    },
  );

  onMounted(async () => {
    recordLogBestEffort({
      level: 'info',
      code: 'app.started',
      message: 'app started',
      path: null,
      line: null,
      fields: { version: __APP_VERSION__ },
    });
    workspacePersistence = watchWorkspacePersistence();
    const persistence = workspacePersistence;
    let shouldPersistRestoredWorkspace = false;
    try {
      persistence.beginRestore();
      await useSaveCommandStore().trackCloseAction(
        restorePersistedWorkspace({
          isCurrent: () => !disposed,
          onModRestoreError: async (modRoot, displayName, error) => {
            if (disposed) return;
            await removeLoadedModRuntime(modRoot, requestClose);
            if (disposed) return;
            workspace.setModOpeningFailure(buildModOpeningFailure(modRoot, error));
            feedback.error(error, `恢复 ${displayName} 失败`);
          },
          onModRestoreWarnings: (displayName, warnings) => {
            if (disposed) return;
            for (const warning of warnings) {
              feedback.warning({ ...warning, userMessage: `${displayName}：${warning.userMessage}` });
            }
          },
        }),
      );
      shouldPersistRestoredWorkspace = !disposed;
    } catch (error) {
      if (!disposed) feedback.error(error, '恢复工作区状态失败');
    } finally {
      try {
        await persistence.finishRestore(shouldPersistRestoredWorkspace);
      } catch (error) {
        if (!disposed) feedback.error(error, '保存工作区状态失败');
      }
    }
  });

  onUnmounted(() => {
    disposed = true;
    debugLog('window.shell_unmounted', () => ({ version: __APP_VERSION__ }));
    workspacePersistence?.stop();
    workspacePersistence = null;
  });
}
