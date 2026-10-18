import { computed, getCurrentScope, h, onScopeDispose, ref } from 'vue';
import type { AppFeedback, GameScanWarning, ModOpeningFailure } from '@/shared/types';

import { useSettingsStore } from '@/stores/settings.store';
import { openEntityImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { openSpecEditorWindow } from '@/windows/spec-editor.window';
import { openWeaponFirePreviewWindow } from '@/windows/weapon-fire-preview.window';
import { useProjectStore } from '@/stores/project.store';
import { pickDirectory, scanDirectoryGameOverview } from '@/services/directory.service';
import { pendingTableSave, saveTableChanges, type TableSaveResult } from '@/orchestrators/table-save.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useTablesStore } from '@/stores/tables.store';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import type { TableDetailAction } from '@/domain/tables/table-detail-actions';
import {
  openFileEditorWindow,
  openGameWarningFileEditor,
  openModOpeningFailureFileEditor,
  type FileEditorRequest,
} from '@/windows/file-editor.window';
import {
  openDirectoryTarget,
  openModFromOverview,
  settleDirectoryOpenings,
  type DirectoryOpeningOutcome,
} from '@/orchestrators/directory-opening.orchestrator';
import {
  captureWorkspaceCloseTarget,
  closeWorkspaceRuntime,
  removeLoadedModRuntime,
} from '@/orchestrators/workspace-lifecycle.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { retryPendingModSyncs, refreshProjectSourcePaths } from '@/orchestrators/project-sync.orchestrator';

import { useWindowLifecycleActions } from '@/app/composables/use-window-close-state';
import { cell, formatModVersion } from '@/shared/lib/starsector';
import { pathBasename } from '@/shared/lib/paths';

export function useWorkspaceShellActions(feedback: AppFeedback) {
  const { requestClose } = useWindowLifecycleActions();
  const project = useProjectStore();
  const tables = useTablesStore();
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const saveCommands = useSaveCommandStore();
  const unregisterSave = saveCommands.registerSaveSession({
    targetKey: computed(() => {
      const target = pendingTableSave()?.target;
      return tables.saving && target ? JSON.stringify([target.manifest.sessionId, target.modRoot, target.table]) : null;
    }),
    modRoot: computed(() => (tables.saving ? (pendingTableSave()?.target.modRoot ?? null) : null)),
    saving: computed(() => tables.saving),
    pendingSynchronization: computed(() => useProjectSyncStore().pending.length > 0),
    waitForSave: async () => {
      const pending = pendingTableSave();
      if (pending)
        return pending.promise.then(
          (result) => result.status !== 'cancelled',
          () => false,
        );
      try {
        for (const modRoot of new Set(useProjectSyncStore().pending.map((entry) => entry.event.modRoot)))
          await retryPendingModSyncs(modRoot);
        return true;
      } catch (error) {
        feedback.error(error, '同步已保存内容失败');
        return false;
      }
    },
  });
  let disposed = false;
  let closeIntent: Promise<boolean> | null = null;
  const removeIntents = new Map<string, Promise<void>>();
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
      unregisterSave();
    });

  async function openDirectory() {
    try {
      const selected = await pickDirectory();
      if (!selected) return;
      const outcome = await openDirectoryTarget(selected, settings.starsectorRoot);
      handleDirectoryOpeningOutcome(outcome, selected);
    } catch (err) {
      feedback.error(err);
    }
  }

  async function loadOverviewMod(modRoot: string) {
    try {
      const outcome = await openModFromOverview(modRoot);
      handleDirectoryOpeningOutcome(outcome, modRoot);
    } catch (err) {
      feedback.error(err);
    }
  }

  const canRefreshOverview = computed(() =>
    workspace.currentView === 'overview'
      ? Boolean(workspace.gameOverview) || project.manifests.size > 0
      : workspace.currentView === 'config' && workspace.configView === 'mod-overview' && Boolean(workspace.activeManifest),
  );

  async function refreshModOverview(modRoot: string) {
    const target = project.getManifest(modRoot)!;
    const accepts = () => !disposed && project.getSessionId(modRoot) === target.sessionId;
    try {
      await refreshProjectSourcePaths(target.sessionId, modRoot, [
        ...target.baseVersions.map((version) => version.path),
        modRoot + '/data',
      ]);
      if (!accepts()) return;
      const refreshed = project.getManifest(modRoot)!;
      workspace.updateModInfo(
        modRoot,
        cell(refreshed.modInfo?.name) || pathBasename(modRoot),
        formatModVersion(refreshed.modInfo?.version),
      );
    } catch (error) {
      if (accepts()) throw error;
    }
  }

  async function refreshWorkspace() {
    const root = workspace.gameOverview?.starsectorRoot;
    const generation = workspace.getWorkspaceGeneration();
    const accepts = () => !disposed && workspace.getWorkspaceGeneration() === generation;
    try {
      if (!root) {
        const targets = [...project.manifests.values()];
        for (const target of targets) {
          if (!accepts()) return;
          if (project.getSessionId(target.modRoot) !== target.sessionId) continue;
          await refreshModOverview(target.modRoot);
        }
        return;
      }
      const overview = await scanDirectoryGameOverview(root);
      if (!accepts() || workspace.gameOverview?.starsectorRoot !== root) return;
      workspace.clearModOpeningFailures();
      workspace.setGameOverview(overview);
      settings.setStarsectorRoot(overview.starsectorRoot);
      recordLogBestEffort({
        level: 'info',
        code: 'workspace.refreshed',
        message: 'workspace refreshed',
        path: null,
        line: null,
        fields: { root: overview.starsectorRoot, mods: String(overview.mods.length) },
      });
      feedback.success(`工作区已刷新：${overview.mods.length} 个 Mod`);
    } catch (err) {
      if (accepts()) feedback.error(err, '刷新工作区失败');
    }
  }

  function confirmCloseWorkspace(notify = true) {
    if (closeIntent) return closeIntent;
    closeIntent = closeWorkspace()
      .then((closed) => {
        if (closed && notify) feedback.success('工作区已关闭');
        return closed;
      })
      .catch((error: unknown) => {
        feedback.error(error, '关闭工作区失败');
        return false;
      })
      .finally(() => {
        closeIntent = null;
      });
    return closeIntent;
  }

  function confirmRemoveMod(modRoot: string) {
    const active = removeIntents.get(modRoot);
    if (active) return active;
    const intent = removeMod(modRoot)
      .catch((error: unknown) => feedback.error(error, '移除 Mod 失败'))
      .finally(() => {
        removeIntents.delete(modRoot);
      });
    removeIntents.set(modRoot, intent);
    return intent;
  }

  async function saveChanges() {
    await saveCurrentTable();
  }

  async function saveCurrentTable() {
    if (tables.saving) return;
    try {
      const result = await saveTableChanges({
        table: tables.currentTab,
        manifest: workspace.activeManifest,
        selectAssociatedSpecs,
        feedback,
      });
      showSaveResult(result);
      return result;
    } catch (err) {
      feedback.error(err, '保存 CSV 失败');
    }
  }

  async function selectAssociatedSpecs(candidates: AssociatedSpecCandidate[]) {
    const { default: AssociatedSpecSaveDialog } = await import('@/app/components/AssociatedSpecSaveDialog.vue');
    const choices = ref(candidates);
    const selectedKeys = ref(new Set(candidates.map((candidate) => candidate.key)));
    const choice = await feedback.choose({
      title: '保存 CSV',
      content: () =>
        h(AssociatedSpecSaveDialog, {
          candidates: choices.value,
          selectedKeys: selectedKeys.value,
          'onUpdate:candidates': (value) => {
            choices.value = value;
          },
          onSelect: (key, checked) => {
            if (checked) selectedKeys.value.add(key);
            else selectedKeys.value.delete(key);
          },
        }),
      choices: [{ label: '保存', value: 'save', type: 'primary' }],
    });
    if (choice !== 'save') return null;
    return choices.value.filter((candidate) => selectedKeys.value.has(candidate.key)).map((candidate) => candidate.change);
  }

  function undoCurrentTableEdit() {
    return runTableAction(applyUndo);
  }

  function applyUndo() {
    const label = tables.undoCurrentTableEdit();
    if (label === null) {
      feedback.error('撤销 CSV 编辑失败');
      return;
    }
    recordLogBestEffort({
      level: 'info',
      code: 'tables.undo_applied',
      message: 'csv undo applied',
      path: null,
      line: null,
      fields: logFields({ modRoot: tables.activeModRoot, table: tables.currentTab, label }),
    });
  }

  function redoCurrentTableEdit() {
    return runTableAction(applyRedo);
  }

  function applyRedo() {
    const label = tables.redoCurrentTableEdit();
    if (label === null) {
      feedback.error('重做 CSV 编辑失败');
      return;
    }
    recordLogBestEffort({
      level: 'info',
      code: 'tables.redo_applied',
      message: 'csv redo applied',
      path: null,
      line: null,
      fields: logFields({ modRoot: tables.activeModRoot, table: tables.currentTab, label }),
    });
  }

  async function addNewRow() {
    if (!workspace.activeManifest) return;
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    try {
      if ((await commitCurrentInput()) === false || root !== tables.activeModRoot || table !== tables.currentTab) return;
      const created = await tables.addNewRow();
      recordLogBestEffort({
        level: 'info',
        code: 'tables.row_created',
        message: 'row created',
        path: null,
        line: null,
        fields: logFields({
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
          rowKey: created?.rowKey,
          rowIndex: created?.rowIndex,
        }),
      });
    } catch (err) {
      feedback.error(err, '新建 CSV 行失败');
    }
  }

  async function deleteSelectedRow() {
    if (!workspace.activeManifest || !tables.selectedRowKey) return;
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    const rowKey = tables.selectedRowKey;
    try {
      const target = tables.editing;
      if (target?.rowKey === tables.selectedRowKey) {
        tables.getTableInputs(target.modRoot, target.table).cancel();
        tables.setActiveCell(null, target.modRoot);
      } else if ((await commitCurrentInput()) === false) return;
      if (root !== tables.activeModRoot || table !== tables.currentTab || rowKey !== tables.selectedRowKey) return;
      const deleted = await tables.deleteSelected();
      recordLogBestEffort({
        level: 'info',
        code: 'tables.row_deleted',
        message: 'row deleted',
        path: null,
        line: null,
        fields: logFields({
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
          rowKey: deleted?.rowKey,
          rowIndex: deleted?.rowIndex,
        }),
      });
    } catch (err) {
      feedback.error(err, '删除 CSV 行失败');
    }
  }

  function commitCurrentInput() {
    const root = tables.activeModRoot;
    return root ? tables.getTableInputs(root, tables.currentTab).commit() : undefined;
  }

  function runTableAction(action: () => void) {
    const pending = commitCurrentInput();
    if (!pending) {
      action();
      return;
    }
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    return pending
      .then((accepted) => {
        if (accepted && tables.activeModRoot === root && tables.currentTab === table) action();
      })
      .catch((error: unknown) => feedback.error(error));
  }

  function handleDetailAction(action: TableDetailAction) {
    if (action.type === 'immersive-editor') {
      const csvTarget = project.tableWriteTargets.find(
        (target) =>
          target.sessionId === action.sessionId &&
          target.modRoot === action.modRoot &&
          target.table === (action.kind === 'ship' ? 'ships' : action.kind === 'weapon' ? 'weapons' : 'wings'),
      )!;
      void openEntityImmersiveEditor(
        {
          root: { sessionId: action.sessionId, modRoot: action.modRoot, kind: action.kind, id: action.id },
          rowKey: action.rowKey,
          csvTarget,
        },
        feedback,
      ).catch((error) => feedback.error(error, '打开沉浸式编辑器失败'));
    } else if (action.type === 'weapon-fire-preview') {
      void openWeaponFirePreviewWindow({
        sessionId: action.sessionId,
        modRoot: action.modRoot,
        id: action.id,
        source: { kind: 'saved' },
      }).catch((error) => feedback.error(error, '打开发射预览失败'));
    } else if (action.type === 'file-editor') {
      void querySessionEntityEditTarget(action.sessionId, action.kind, action.id)
        .then((info) =>
          openRequestedFileEditor({
            modRoot: action.modRoot,
            sessionId: action.sessionId,
            title: action.title,
            path: info.target.write.path,
          }),
        )
        .catch((error) => feedback.error(error, '读取规格文件目标失败'));
    } else {
      openRequestedEditorWindow(action);
    }
  }

  function openRequestedFileEditor(request: FileEditorRequest) {
    recordLogBestEffort({
      level: 'info',
      code: 'editor.file_opened',
      message: 'file editor opened',
      path: request.path,
      line: request.line ?? null,
      fields: logFields({ modRoot: request.modRoot, sessionId: request.sessionId }),
    });
    openFileEditorWindow({ ...request }).catch((error) => feedback.error(error, '打开文件编辑器失败'));
  }

  function openGameWarningFile(warning: GameScanWarning) {
    openGameWarningFileEditor(warning)?.catch((error) => feedback.error(error, '打开警告文件失败'));
  }

  function openModOpeningFailureFile(failure: ModOpeningFailure) {
    openModOpeningFailureFileEditor(failure)?.catch((error) => feedback.error(error, '打开错误文件失败'));
  }

  function handleDirectoryOpeningOutcome(outcome: DirectoryOpeningOutcome, path: string | null = null) {
    if (outcome.type === 'cancelled') return;
    if (outcome.type === 'game-overview') {
      if (workspace.gameOverview?.starsectorRoot) settings.setStarsectorRoot(workspace.gameOverview.starsectorRoot);
      feedback.success(`游戏目录已扫描：${outcome.availableModCount} 个 Mod`);
      recordLogBestEffort({
        level: 'info',
        code: 'directory.scanned',
        message: 'game directory scanned',
        path: null,
        line: null,
        fields: { root: outcome.root, mods: String(outcome.availableModCount) },
      });
    } else if (outcome.type === 'mod-loaded') {
      if (workspace.gameOverview?.starsectorRoot) settings.setStarsectorRoot(workspace.gameOverview.starsectorRoot);
      feedback.success(`Mod 已导入：${outcome.modName}`);
      for (const warning of outcome.warnings) {
        feedback.warning(warning);
      }
    } else if (outcome.type === 'already-loaded') {
      feedback.info('该 Mod 已在工作区中');
      recordLogBestEffort({
        level: 'info',
        code: 'mod.already_loaded',
        message: 'mod already loaded',
        path: null,
        line: null,
        fields: logFields({ modRoot: outcome.modRoot, name: outcome.modName }),
      });
    } else {
      feedback.error(outcome.message ?? '未识别该目录');
      recordLogBestEffort({
        level: 'info',
        code: 'directory.unrecognized',
        message: outcome.message ?? 'unrecognized directory',
        path,
        line: null,
        fields: null,
      });
    }
  }

  async function removeMod(modRoot: string) {
    await saveCommands.settleCloseActions();
    await settleDirectoryOpenings();
    if (disposed) return;
    if (!(await removeLoadedModRuntime(modRoot, requestClose))) return;
    recordLogBestEffort({
      level: 'info',
      code: 'mod.removed',
      message: 'mod removed',
      path: null,
      line: null,
      fields: { modRoot },
    });
    feedback.success('Mod 已从工作区移除');
  }

  async function closeWorkspace() {
    await saveCommands.settleCloseActions();
    await settleDirectoryOpenings();
    const target = captureWorkspaceCloseTarget();
    if (!(await closeWorkspaceRuntime(target, requestClose))) return false;
    recordLogBestEffort({
      level: 'info',
      code: 'workspace.closed',
      message: 'workspace closed',
      path: null,
      line: null,
      fields: { mods: String(target.modRoots.length) },
    });
    return true;
  }

  function showSaveResult(result: TableSaveResult) {
    if (result.status === 'saved') {
      feedback.success('当前 CSV 表已保存');
    } else if (result.status === 'noop') {
      feedback.info('没有需要保存的修改');
    }
  }

  function openRequestedEditorWindow(action: Extract<TableDetailAction, { type: 'editor-window' }>) {
    recordLogBestEffort({
      level: 'info',
      code: 'editor.window_opened',
      message: 'editor window opened',
      path: null,
      line: null,
      fields: logFields({ kind: action.kind, id: action.id, modRoot: action.modRoot, sessionId: action.sessionId }),
    });
    openSpecEditorWindow({
      kind: action.kind,
      modRoot: action.modRoot,
      id: action.id,
      sessionId: action.sessionId,

      starsectorRoot: action.starsectorRoot,
    }).catch((error) => feedback.error(error, '打开编辑器窗口失败'));
  }

  return {
    settleDirectoryOpenings,
    selectAssociatedSpecs,
    addNewRow,
    confirmCloseWorkspace,
    confirmRemoveMod,
    deleteSelectedRow,
    handleDetailAction,
    loadOverviewMod,
    openGameWarningFile,
    openModOpeningFailureFile,
    openDirectory,
    redoCurrentTableEdit,
    refreshWorkspace,
    refreshModOverview,
    canRefreshOverview,
    saveChanges,
    saveCurrentTable,
    undoCurrentTableEdit,
  };
}
