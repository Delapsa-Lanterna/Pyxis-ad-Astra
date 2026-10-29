import { computed, getCurrentScope, onScopeDispose } from 'vue';
import type { AppFeedback, GameScanWarning, ModOpeningFailure } from '@/shared/types';

import { useProjectStore } from '@/stores/project.store';
import { pickDirectory, scanDirectoryGameOverview } from '@/services/directory.service';

import { useSaveCommandStore } from '@/stores/save-command.store';

import { openGameWarningFileEditor, openModOpeningFailureFileEditor } from '@/windows/file-editor.window';
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

import { refreshProjectSourcePaths } from '@/orchestrators/project-sync.orchestrator';

import { useWindowLifecycleActions } from '@/app/composables/use-window-close-state';
import { cell, formatModVersion } from '@/shared/lib/starsector';
import { pathBasename, normalizeFsPath, gameCoreDirectoryPath } from '@/shared/lib/paths';
import { refreshCoreAssets } from '@/orchestrators/core-assets.orchestrator';

export function useWorkspaceShellActions(feedback: AppFeedback) {
  const { requestClose } = useWindowLifecycleActions();
  const project = useProjectStore();
  const workspace = useWorkspaceStore();
  const saveCommands = useSaveCommandStore();
  let disposed = false;
  let closeIntent: Promise<boolean> | null = null;
  const removeIntents = new Map<string, Promise<void>>();
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
    });

  async function openDirectory() {
    try {
      const selected = await pickDirectory();
      if (!selected) return;
      const outcome = await openDirectoryTarget(selected, workspace.gameOverview?.starsectorRoot ?? null);
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
      : workspace.currentView === 'mod-overview' && Boolean(workspace.activeManifest),
  );

  async function refreshModSources(modRoot: string, paths: string[]) {
    const target = project.getManifest(modRoot)!;
    const accepts = () => !disposed && project.getSessionId(modRoot) === target.sessionId;
    try {
      await refreshProjectSourcePaths(target.sessionId, modRoot, paths);
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

  function refreshModOverview(modRoot: string) {
    return refreshModSources(
      modRoot,
      ['mod_info.json', 'data', 'graphics'].map((path) => modRoot + '/' + path),
    );
  }

  async function refreshTabInfo(modRoots: string[]) {
    const targets = modRoots.map((root) => project.getManifest(root)!);
    for (const target of targets) {
      if (disposed) return;
      if (project.getSessionId(target.modRoot) === target.sessionId)
        await refreshModSources(target.modRoot, [target.modRoot + '/mod_info.json']);
    }
  }

  async function refreshCore(root: string) {
    const coreRoot = gameCoreDirectoryPath(root);
    const targets = [...project.manifests.values()].filter(
      (manifest) => normalizeFsPath(manifest.starsectorRoot ?? '') === normalizeFsPath(root),
    );
    if (!targets.length) return refreshCoreAssets(root);
    for (const target of targets) {
      if (disposed) return;
      if (project.getSessionId(target.modRoot) !== target.sessionId) continue;
      await refreshProjectSourcePaths(
        target.sessionId,
        target.modRoot,
        normalizeFsPath(target.modRoot) === normalizeFsPath(coreRoot)
          ? ['mod_info.json', 'data', 'graphics'].map((path) => target.modRoot + '/' + path)
          : [],
        [
          { source: 'core', relPath: 'data' },
          { source: 'core', relPath: 'graphics' },
        ],
      );
    }
  }

  async function refreshWorkspace() {
    const root = workspace.gameOverview?.starsectorRoot;
    const generation = workspace.getWorkspaceGeneration();
    const accepts = () => !disposed && workspace.getWorkspaceGeneration() === generation;
    const targets = [...project.manifests.values()];
    try {
      const overview = root ? await scanDirectoryGameOverview(root) : null;
      if (!accepts() || workspace.gameOverview?.starsectorRoot !== root) return;
      if (overview) {
        workspace.clearModOpeningFailures();
        workspace.setGameOverview(overview, false);
      }
      for (const target of targets) {
        if (!accepts()) return;
        if (project.getSessionId(target.modRoot) === target.sessionId) await refreshModOverview(target.modRoot);
      }
      if (!overview || !accepts()) return;
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

  function confirmCloseWorkspace() {
    if (closeIntent) return closeIntent;
    closeIntent = closeWorkspace()
      .then((closed) => {
        if (closed) feedback.success('工作区已关闭');
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

  function openGameWarningFile(warning: GameScanWarning) {
    openGameWarningFileEditor(warning)?.catch((error) => feedback.error(error, '打开警告文件失败'));
  }

  function openModOpeningFailureFile(failure: ModOpeningFailure) {
    openModOpeningFailureFileEditor(failure)?.catch((error) => feedback.error(error, '打开错误文件失败'));
  }

  function handleDirectoryOpeningOutcome(outcome: DirectoryOpeningOutcome, path: string | null = null) {
    if (outcome.type === 'cancelled') return;
    if (outcome.type === 'game-overview') {
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

  return {
    settleDirectoryOpenings,
    confirmCloseWorkspace,
    confirmRemoveMod,
    loadOverviewMod,
    openGameWarningFile,
    openModOpeningFailureFile,
    openDirectory,
    refreshWorkspace,
    refreshModOverview,
    refreshTabInfo,
    refreshCore,
    canRefreshOverview,
  };
}
