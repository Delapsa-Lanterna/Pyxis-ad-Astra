import type { AppFeedback } from '@/shared/types';
import { replayNextFileRedo, replayNextFileUndo } from '@/orchestrators/file-history-replay.orchestrator';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';

export async function dispatchMainUndoCommand(feedback: AppFeedback) {
  await dispatchMainHistoryCommand('undo', feedback);
}

export async function dispatchMainRedoCommand(feedback: AppFeedback) {
  await dispatchMainHistoryCommand('redo', feedback);
}

async function dispatchMainHistoryCommand(direction: 'undo' | 'redo', feedback: AppFeedback) {
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
  const replay = direction === 'undo' ? replayNextFileUndo : replayNextFileRedo;
  await replay(useProjectStore(), tables, feedback);
}
