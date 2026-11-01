import type { FileChangeReplayDirection, FileHistoryEntrySummary, WriteResult } from '@/shared/types';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { replayFileChangeSet, loadFileHistory } from '@/services/file-history.service';

import { AppError } from '@/shared/lib/errors';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';

type ProjectStore = ReturnType<typeof useProjectStore>;
export type FileHistoryReplayDirection = FileChangeReplayDirection;

export async function refreshLoadedFileHistory(accepts: () => boolean): Promise<void> {
  const project = useProjectStore();
  const fileHistory = useFileHistoryStore();
  const results = await Promise.allSettled(
    [...project.manifests.values()].map(async ({ sessionId, modRoot }) => {
      try {
        const snapshot = await loadFileHistory(sessionId, modRoot);
        if (accepts() && project.getSessionId(modRoot) === sessionId) fileHistory.applySnapshot(modRoot, snapshot);
      } catch (error) {
        if (accepts() && project.getSessionId(modRoot) === sessionId) throw error;
      }
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

export interface FileHistoryReplayPlan {
  actionText: string;
  direction: FileHistoryReplayDirection;
  entry: FileHistoryEntrySummary;
  modRoot: string;
  sessionId: string;
  revision: number;
}

interface FileHistoryReplayBehavior {
  actionText: string;
  peekEntry: (modRoot: string) => FileHistoryEntrySummary | null;
}

export function createFileReplayPlan(
  project: ProjectStore,
  direction: FileHistoryReplayDirection,
  modRoot: string | null,
): FileHistoryReplayPlan | null {
  if (!modRoot) return null;
  const sessionId = project.getSessionId(modRoot);
  if (!sessionId) return null;
  const behavior = replayBehavior(direction);
  const entry = behavior.peekEntry(modRoot);
  if (!entry) return null;
  return {
    actionText: behavior.actionText,
    direction,
    entry,
    modRoot,
    sessionId,
    revision: useFileHistoryStore().getHistoryStacks(modRoot).revision,
  };
}

export async function executeFileReplayPlan(plan: FileHistoryReplayPlan, project: ProjectStore): Promise<WriteResult> {
  assertReplayPlanStillCurrent(plan, project);
  const result = await replayFileChangeSet(plan.sessionId, plan.modRoot, plan.direction, plan.entry.id, plan.revision);
  if (project.getSessionId(plan.modRoot) !== plan.sessionId) return result;
  recordLogBestEffort({
    level: 'info',
    code: 'history.replayed',
    message: 'file history replayed',
    path: null,
    line: null,
    fields: logFields({
      modRoot: plan.modRoot,
      sessionId: plan.sessionId,
      direction: plan.direction,
      entryId: plan.entry.id,
      label: plan.entry.label,
      changes: result.changes.length,
    }),
  });
  return result;
}

function assertReplayPlanStillCurrent(plan: FileHistoryReplayPlan, project: ProjectStore): void {
  const behavior = replayBehavior(plan.direction);
  const currentEntry = behavior.peekEntry(plan.modRoot);
  if (currentEntry?.id !== plan.entry.id) {
    throw new AppError(`${plan.actionText}文件历史失败：历史栈状态已变化`, { action: 'execute-file-history-replay' });
  }
  const currentSessionId = project.getSessionId(plan.modRoot);
  if (currentSessionId !== plan.sessionId) {
    throw new AppError(`${plan.actionText}文件历史失败：ProjectSession 已变化`, { action: 'execute-file-history-replay' });
  }
}

function replayBehavior(direction: FileHistoryReplayDirection): FileHistoryReplayBehavior {
  const fileHistory = useFileHistoryStore();
  if (direction === 'undo') {
    return {
      actionText: '撤销',
      peekEntry: (modRoot) => fileHistory.peekSavedWriteUndo(modRoot),
    };
  }
  return {
    actionText: '重做',
    peekEntry: (modRoot) => fileHistory.peekSavedWriteRedo(modRoot),
  };
}
