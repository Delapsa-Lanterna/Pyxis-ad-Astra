import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useModFileBrowserStore } from '@/stores/mod-file-browser.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { invalidateCoreCacheForRoot } from '@/services/core-assets.service';
import { invalidateQueryCacheForSession } from '@/services/query-cache.service';
import { invalidateResourceMediaForSession } from '@/services/resource-media.service';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import type { CloseScope, CloseResult, ProjectManifest } from '@/shared/types';
type RequestClose = (scope: CloseScope) => Promise<CloseResult>;
import { markProjectionReady } from '@/services/project-projection.service';
import { releaseProjectSession } from '@/orchestrators/project-sync.orchestrator';
import { pathBasename } from '@/shared/lib/paths';

export interface WorkspaceCloseTarget {
  gameOverviewRoot: string | null;
  modRoots: string[];
  starsectorRoots: string[];
}

async function closeTargets(targets: ProjectManifest[], requestClose: RequestClose) {
  const result = await requestClose({ kind: 'sessions', sessionIds: targets.map((target) => target.sessionId) });
  acceptReleasedSessions(result.releasedSessions);
  if (result.diagnostic) throw result.diagnostic;
  return result.status === 'closed';
}

export function acceptReleasedSessions(sessionIds: string[]) {
  const errors: unknown[] = [];
  for (const target of [...useProjectStore().manifests.values()]) {
    if (!sessionIds.includes(target.sessionId)) continue;
    try {
      removeClosedMod(target.modRoot);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Project release failed');
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
  const tables = useCsvEditorStore();
  const fileHistory = useFileHistoryStore();
  const writeSync = useProjectSyncStore();
  const sessionId = project.getSessionId(modRoot);
  if (sessionId) useJsonEditorStore().releaseSession(sessionId);
  useModFileBrowserStore().removeModState(modRoot);
  workspace.removeLoadedModEntry(modRoot);
  tables.removeModState(modRoot);
  fileHistory.removeModState(modRoot);
  writeSync.removeModState(modRoot, project.getSessionId(modRoot));
  project.removeProjectManifest(modRoot);
}

export async function removeLoadedModRuntime(modRoot: string, requestClose: RequestClose) {
  const workspace = useWorkspaceStore(),
    project = useProjectStore();
  // Core is an attached tab when no game overview owns the workspace.
  const roots =
    !workspace.hasGameWorkspace &&
    workspace.loadedModList.every((mod) => mod.modRoot === modRoot || pathBasename(mod.modRoot).toLowerCase() === 'starsector-core')
      ? workspace.loadedModList.map((mod) => mod.modRoot)
      : [modRoot];
  const targets = roots.flatMap((root) => project.getManifest(root) ?? []);
  if (targets.length && !(await closeTargets(targets, requestClose))) return false;
  for (const root of roots) if (!targets.some((target) => target.modRoot === root)) removeModRuntimeState(root);
  return true;
}

function removeClosedMod(modRoot: string) {
  const project = useProjectStore();
  const sessionId = project.getSessionId(modRoot);

  if (sessionId) {
    markProjectionReady(sessionId);
    invalidateQueryCacheForSession(sessionId);
    invalidateResourceMediaForSession(sessionId);
    try {
      releaseProjectSession(sessionId);
    } finally {
      removeModRuntimeState(modRoot);
    }
  }

  if (!sessionId) removeModRuntimeState(modRoot);

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
