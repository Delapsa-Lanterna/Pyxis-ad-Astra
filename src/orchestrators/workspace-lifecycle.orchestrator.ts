import { useModFileBrowserStore } from '@/stores/mod-file-browser.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { invalidateCoreCacheForRoot } from '@/services/core-assets.service';
import { invalidateQueryCacheForSession } from '@/services/query-cache.service';
import { invalidateResourceCacheForSession } from '@/services/resource-cache.service';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import type { CloseScope, CloseResult, ProjectManifest } from '@/shared/types';
type RequestClose = (scope: CloseScope) => Promise<CloseResult>;
import { markProjectionReady } from '@/services/project-projection.service';

export interface WorkspaceCloseTarget {
  gameOverviewRoot: string | null;
  modRoots: string[];
  starsectorRoots: string[];
}

async function closeTargets(targets: ProjectManifest[], requestClose: RequestClose) {
  const result = await requestClose({ kind: 'sessions', sessionIds: targets.map((target) => target.sessionId) });
  for (const target of targets) if (result.releasedSessions.includes(target.sessionId)) removeClosedMod(target.modRoot);
  if (result.diagnostic) throw result.diagnostic;
  return result.status === 'closed';
}

export function captureWorkspaceCloseTarget(): WorkspaceCloseTarget {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  const starsectorRoots = new Set(
    [workspace.gameOverview?.starsectorRoot, ...[...project.manifests.values()].map((manifest) => manifest.starsectorRoot)].filter(
      (root): root is string => Boolean(root),
    ),
  );
  return {
    gameOverviewRoot: workspace.gameOverview?.starsectorRoot ?? null,
    modRoots: workspace.loadedModList.map((mod) => mod.modRoot),
    starsectorRoots: [...starsectorRoots],
  };
}

export function removeModRuntimeState(modRoot: string) {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  const tables = useTablesStore();
  const fileHistory = useFileHistoryStore();
  const csvEditHistory = useTablesEditHistoryStore();
  const writeSync = useProjectSyncStore();
  useModFileBrowserStore().removeModState(modRoot);
  workspace.removeLoadedModEntry(modRoot);
  tables.removeModState(modRoot);
  fileHistory.removeModState(modRoot);
  csvEditHistory.clearForMod(modRoot);
  writeSync.removeModState(modRoot, project.getSessionId(modRoot));
  project.removeProjectManifest(modRoot);
}

export async function removeLoadedModRuntime(modRoot: string, requestClose: RequestClose) {
  const target = useProjectStore().getManifest(modRoot);
  if (!target) {
    removeModRuntimeState(modRoot);
    return true;
  }
  return closeTargets([target], requestClose);
}

function removeClosedMod(modRoot: string) {
  const project = useProjectStore();
  const sessionId = project.getSessionId(modRoot);

  if (sessionId) {
    markProjectionReady(sessionId);
    invalidateQueryCacheForSession(sessionId);
    invalidateResourceCacheForSession(sessionId);
  }

  removeModRuntimeState(modRoot);

  recordLogBestEffort({
    level: 'info',
    code: 'mod.session_closed',
    message: 'mod session closed',
    path: null,
    line: null,
    fields: logFields({ modRoot, sessionId }),
  });
}

export async function closeWorkspaceRuntime(target: WorkspaceCloseTarget, requestClose: RequestClose) {
  const targets = target.modRoots.flatMap((root) => useProjectStore().getManifest(root) ?? []);
  if (!(await closeTargets(targets, requestClose))) return false;

  const workspace = useWorkspaceStore();
  workspace.revokeWorkspaceGeneration();
  for (const root of target.modRoots) if (!targets.some((manifest) => manifest.modRoot === root)) removeModRuntimeState(root);
  await Promise.all(target.starsectorRoots.map((root) => invalidateCoreCacheForRoot(root)));
  if (workspace.gameOverview?.starsectorRoot === target.gameOverviewRoot) {
    workspace.setGameOverview(null);
  }
  workspace.clearModOpeningFailures();
  if (!workspace.activeModRoot) workspace.showOverview();
  return true;
}
