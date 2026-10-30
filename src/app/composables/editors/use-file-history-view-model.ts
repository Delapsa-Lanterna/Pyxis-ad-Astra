import { computed, watch } from 'vue';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { replayNextFileRedo, replayNextFileUndo } from '@/orchestrators/file-history-replay.orchestrator';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { clearSavedFileHistory, loadFileHistory } from '@/services/file-history.service';

export function useFileHistoryViewModel() {
  const project = useProjectStore();
  const workspace = useWorkspaceStore();
  const tables = useCsvEditorStore();
  const fileHistory = useFileHistoryStore();
  const feedback = useAppFeedback();

  const activeMod = computed(() => workspace.activeManifest);
  const reads = useQueryReadOwner();
  async function refresh(current: () => boolean = () => true) {
    const target = activeMod.value;
    if (!target) return;
    const accepts = () => current() && project.getSessionId(target.modRoot) === target.sessionId;
    await reads.consume(
      'history',
      { sessionId: target.sessionId, modRoot: target.modRoot },
      () => loadFileHistory(target.sessionId, target.modRoot),
      {
        ready: (snapshot) => {
          if (accepts()) fileHistory.applySnapshot(target.modRoot, snapshot);
        },
        error: (error) => {
          if (accepts()) feedback.error(error, '读取文件历史失败');
        },
      },
    );
  }
  const identity = () => JSON.stringify([activeMod.value?.sessionId, activeMod.value?.modRoot]);
  watch(
    identity,
    () => {
      reads.revoke();
      void refresh();
    },
    { immediate: true },
  );
  useContextMenuScope({ identity, refresh, canRefresh: () => Boolean(activeMod.value) });
  const modTitle = computed(() => activeMod.value?.modInfo?.name ?? activeMod.value?.modRoot ?? '未选择 Mod');
  const stacks = computed(() =>
    activeMod.value ? fileHistory.getHistoryStacks(activeMod.value.modRoot) : { undoStack: [], redoStack: [] },
  );
  const undoStack = computed(() => stacks.value.undoStack);
  const redoStack = computed(() => stacks.value.redoStack);
  const undoDisplayItems = computed(() => [...undoStack.value].reverse());
  const redoDisplayItems = computed(() => [...redoStack.value].reverse());
  const historyCount = computed(() => undoStack.value.length + redoStack.value.length);
  const canUndo = computed(
    () =>
      !useProjectSyncStore().isWaiting(activeMod.value?.modRoot) &&
      Boolean(fileHistory.peekSavedWriteUndo(activeMod.value?.modRoot ?? null)),
  );
  const canRedo = computed(
    () =>
      !useProjectSyncStore().isWaiting(activeMod.value?.modRoot) &&
      Boolean(fileHistory.peekSavedWriteRedo(activeMod.value?.modRoot ?? null)),
  );

  function confirmClear() {
    const modData = activeMod.value;
    if (!modData || historyCount.value === 0) return;
    feedback.confirmWarning({
      title: '清空文件历史',
      content: '这会清空当前 Mod 的文件级 undo/redo 栈，不会修改任何磁盘文件。确认清空？',
      actionText: '清空',
      onConfirm: async () => {
        try {
          const snapshot = await clearSavedFileHistory(modData.sessionId, modData.modRoot);
          if (project.getSessionId(modData.modRoot) === modData.sessionId) fileHistory.applySnapshot(modData.modRoot, snapshot);
          feedback.success('文件历史已清空');
        } catch (error) {
          feedback.error(error, '清空文件历史失败');
        }
      },
    });
  }

  function undoOne() {
    return replayNextFileUndo(project, tables, feedback);
  }

  function redoOne() {
    return replayNextFileRedo(project, tables, feedback);
  }

  return {
    modTitle,
    refresh,
    undoStack,
    redoStack,
    undoDisplayItems,
    redoDisplayItems,
    historyCount,
    canUndo,
    canRedo,
    confirmClear,
    undoOne,
    redoOne,
  };
}
