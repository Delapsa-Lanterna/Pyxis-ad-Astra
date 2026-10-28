import { h } from 'vue';
import type { AppFeedback, FileChangeReplayDirection, FileHistoryEntrySummary } from '@/shared/types';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { replayFileChangeSet, loadFileHistory } from '@/services/file-history.service';

import { AppError } from '@/shared/lib/errors';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';

type ProjectStore = ReturnType<typeof useProjectStore>;
type TablesStore = ReturnType<typeof useCsvEditorStore>;
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

export function replayNextFileUndo(project: ProjectStore, tables: TablesStore, feedback: AppFeedback) {
  return replayNextFileHistoryEntry('undo', project, tables, feedback);
}

export function replayNextFileRedo(project: ProjectStore, tables: TablesStore, feedback: AppFeedback) {
  return replayNextFileHistoryEntry('redo', project, tables, feedback);
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

export async function executeFileReplayPlan(plan: FileHistoryReplayPlan, project: ProjectStore, tables: TablesStore): Promise<void> {
  const tableTarget = { sessionId: plan.sessionId, modRoot: plan.modRoot, table: tables.currentTab };
  assertReplayPlanStillCurrent(plan, project);
  const result = await replayFileChangeSet(plan.sessionId, plan.modRoot, plan.direction, plan.entry.id, plan.revision);
  if (project.getSessionId(plan.modRoot) !== plan.sessionId) return;
  if (useWorkspaceStore().activeModRoot === plan.modRoot && result.sessionUpdates.some((update) => update.modRoot === plan.modRoot))
    tables.selectRowByKey(tableTarget, null);
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
}

async function replayNextFileHistoryEntry(
  direction: FileHistoryReplayDirection,
  project: ProjectStore,
  tables: TablesStore,
  feedback: AppFeedback,
) {
  const root = useWorkspaceStore().activeModRoot;
  if (useProjectSyncStore().isWaiting(root)) return false;
  const session = root ? project.getSessionId(root) : null;
  if (root && session) {
    try {
      const snapshot = await loadFileHistory(session, root);
      if (project.getSessionId(root) !== session) return false;
      useFileHistoryStore().applySnapshot(root, snapshot);
    } catch (error) {
      feedback.error(error, '读取文件历史失败');
      return false;
    }
  }
  const plan = createFileReplayPlan(project, direction, root);
  if (!plan) return false;
  confirmFileHistoryReplay(feedback, plan, async () => {
    try {
      await executeFileReplayPlan(plan, project, tables);
      feedback.success(`文件历史已${plan.actionText}`);
    } catch (error) {
      feedback.error(error, `${plan.actionText}文件历史失败`);
    }
  });
  return true;
}

function confirmFileHistoryReplay(feedback: AppFeedback, plan: FileHistoryReplayPlan, onConfirm: () => Promise<void>) {
  feedback.confirmWarning({
    title: `${plan.actionText}文件历史`,
    content: () => renderConfirmContent(plan.entry, plan.actionText),
    actionText: plan.actionText,
    onConfirm,
  });
}

function renderConfirmContent(entry: FileHistoryEntrySummary, action: string) {
  const paths = historyEntryPaths(entry);
  return h('div', { class: 'file-history-confirm' }, [
    h('p', `${action}会直接写回磁盘。`),
    h('p', `历史记录：${entry.label}`),
    h('p', `涉及路径：${paths.length} 条`),
    h(
      'ul',
      { class: 'file-history-confirm-list' },
      paths.map((path) => h('li', { key: path }, path)),
    ),
  ]);
}

function historyEntryPaths(entry: FileHistoryEntrySummary): string[] {
  return entry.paths;
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
