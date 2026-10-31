import { h } from 'vue';
import type { AppFeedback, FileHistoryEntrySummary } from '@/shared/types';
import {
  createFileReplayPlan,
  executeFileReplayPlan,
  type FileHistoryReplayDirection,
  type FileHistoryReplayPlan,
} from '@/orchestrators/file-history-replay.orchestrator';
import { loadFileHistory } from '@/services/file-history.service';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';

export async function dispatchWorkspaceHistoryCommand(direction: 'undo' | 'redo', feedback: AppFeedback) {
  const tables = useCsvEditorStore();
  const workspace = useWorkspaceStore();
  const modRoot = workspace.activeModRoot;
  const sessionId = workspace.activeSessionId;
  const view = workspace.currentView;
  const table = tables.currentTab;
  const page = workspace.jsonPage;
  const isCurrent = () =>
    workspace.activeModRoot === modRoot &&
    workspace.activeSessionId === sessionId &&
    workspace.currentView === view &&
    (view !== 'table' || tables.currentTab === table) &&
    (view !== 'json-editor' || workspace.jsonPage === page);
  const label = `${direction === 'undo' ? '撤销' : '重做'} ${view === 'json-editor' ? 'JSON' : 'CSV'} 编辑失败`;
  try {
    const editor = view === 'json-editor' ? useJsonEditorStore().active : view === 'table' ? tables.activeEditor : null;
    if (view === 'table' && tables.currentTableLocked) return;
    if (editor) {
      const result = await editor[direction]();
      if (!isCurrent()) return;
      if (result === false) feedback.error(label);
      if (result !== null) return;
    }
  } catch (error) {
    feedback.error(error, label);
    return;
  }
  if (useProjectSyncStore().isWaiting(modRoot)) return;
  const replay = direction === 'undo' ? replayWorkspaceFileUndo : replayWorkspaceFileRedo;
  await replay(useProjectStore(), tables, feedback);
}

type ProjectStore = ReturnType<typeof useProjectStore>;
type TablesStore = ReturnType<typeof useCsvEditorStore>;

export function replayWorkspaceFileUndo(project: ProjectStore, tables: TablesStore, feedback: AppFeedback) {
  return replayWorkspaceFileHistory('undo', project, tables, feedback);
}

export function replayWorkspaceFileRedo(project: ProjectStore, tables: TablesStore, feedback: AppFeedback) {
  return replayWorkspaceFileHistory('redo', project, tables, feedback);
}

async function replayWorkspaceFileHistory(
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
      const tableTarget = { sessionId: plan.sessionId, modRoot: plan.modRoot, table: tables.currentTab };
      const result = await executeFileReplayPlan(plan, project);
      if (
        project.getSessionId(plan.modRoot) === plan.sessionId &&
        useWorkspaceStore().activeModRoot === plan.modRoot &&
        result.sessionUpdates.some((update) => update.modRoot === plan.modRoot)
      )
        tables.selectRowByKey(tableTarget, null);
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
  const paths = entry.paths;
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
