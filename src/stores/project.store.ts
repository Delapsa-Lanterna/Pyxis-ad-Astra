import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ProjectManifest, ProjectSessionId } from '@/shared/types';
import { cell } from '@/shared/lib/starsector';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { TABLE_KEYS } from '@/shared/types';
import { joinRootRelativePath } from '@/shared/lib/paths';

export const useProjectStore = defineStore('project', () => {
  const manifests = ref<Map<string, ProjectManifest>>(new Map());
  const projectionRevisions = new Map<string, number>();
  const tableWriteTargets = computed(() =>
    [...manifests.value.values()].flatMap((manifest) =>
      TABLE_KEYS.map((table) => ({
        sessionId: manifest.sessionId,
        modRoot: manifest.modRoot,
        table,
        path: joinRootRelativePath(manifest.modRoot, manifest.tableSummaries[table].path),
      })),
    ),
  );

  // Active mod identity is owned by the workspace store; project projects it
  // onto its manifests instead of keeping its own copy in sync.
  const activeModRoot = computed(() => useWorkspaceStore().activeModRoot);
  const activeManifest = computed<ProjectManifest | null>(() =>
    activeModRoot.value ? (manifests.value.get(activeModRoot.value) ?? null) : null,
  );
  const activeSessionId = computed<ProjectSessionId | null>(() => activeManifest.value?.sessionId ?? null);
  const projectName = computed(() => cell(activeManifest.value?.modInfo?.name) || '星界罗盘 [Circinus ad Astra]');

  function getManifest(modRoot: string): ProjectManifest | null {
    return manifests.value.get(modRoot) ?? null;
  }

  function getSessionId(modRoot: string): ProjectSessionId | null {
    return getManifest(modRoot)?.sessionId ?? null;
  }

  function removeProjectManifest(modRoot: string) {
    const sessionId = manifests.value.get(modRoot)?.sessionId;
    if (sessionId) projectionRevisions.delete(sessionId);
    manifests.value.delete(modRoot);
  }

  function registerProjectManifest(manifest: ProjectManifest) {
    projectionRevisions.set(manifest.sessionId, 0);
    manifests.value.set(manifest.modRoot, manifest);
  }

  function replaceProjectManifest(manifest: ProjectManifest, projectionRevision: number) {
    if (manifests.value.get(manifest.modRoot)?.sessionId !== manifest.sessionId) return;
    if (projectionRevision <= (projectionRevisions.get(manifest.sessionId) ?? 0)) return;
    projectionRevisions.set(manifest.sessionId, projectionRevision);
    manifests.value.set(manifest.modRoot, manifest);
  }

  return {
    tableWriteTargets,
    activeManifest,
    activeModRoot,
    activeSessionId,
    manifests,
    projectName,
    getManifest,
    getSessionId,
    removeProjectManifest,
    registerProjectManifest,
    replaceProjectManifest,
  };
});
