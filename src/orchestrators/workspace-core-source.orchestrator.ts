import { AppError } from '@/shared/lib/errors';
import type { CloseScope, CloseResult } from '@/shared/types';
import {
  captureWorkspaceCloseTarget,
  closeWorkspaceRuntime,
  removeLoadedModRuntime,
} from '@/orchestrators/workspace-lifecycle.orchestrator';
import { settleDirectoryOpenings } from '@/orchestrators/directory-opening.orchestrator';
import {
  beginWorkspaceRestore,
  finishWorkspaceRestore,
  restorePersistedWorkspace,
} from '@/orchestrators/workspace-persistence.orchestrator';
import { detectDirectoryTarget } from '@/services/directory.service';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { buildModOpeningFailure } from '@/domain/project/load-diagnostics';
export async function switchWorkspaceCoreSource(
  root: string | null,
  requestClose: (scope: CloseScope) => Promise<CloseResult>,
  commitSettings: () => Promise<void>,
) {
  const commands = useSaveCommandStore();
  await commands.settleCloseActions();
  await settleDirectoryOpenings();
  if (root && (await detectDirectoryTarget(root, null)).kind !== 'game-root')
    throw new AppError(`请选择 Starsector 游戏安装目录: ${root}`, { action: 'core-source' });
  const workspace = useWorkspaceStore();
  const snapshot = workspace.toPersistedState();
  beginWorkspaceRestore();
  const closed = await closeWorkspaceRuntime(captureWorkspaceCloseTarget(), requestClose).catch(async (error) => {
    await commands.trackCloseAction(finishWorkspaceRestore());
    throw error;
  });
  if (!closed) {
    await commands.trackCloseAction(finishWorkspaceRestore());
    return false;
  }
  // Close preparation finishes before tracking the commit, restore and final snapshot.
  await commands.trackCloseAction(commitAndReopen().finally(finishWorkspaceRestore));
  return true;
  async function commitAndReopen() {
    try {
      await commitSettings();
    } finally {
      await restorePersistedWorkspace(
        {
          onModRestoreError: async (modRoot, _name, error) => {
            await removeLoadedModRuntime(modRoot, requestClose);
            workspace.setModOpeningFailure(buildModOpeningFailure(modRoot, error));
          },
        },
        snapshot,
      );
    }
  }
}
