import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ProjectManifest, ProjectSessionId } from '@/shared/types';
import { TABLE_KEYS } from '@/shared/types';
import { joinRootRelativePath } from '@/shared/lib/paths';

export const useProjectStore = defineStore('project', () => {
  const manifests = ref<Map<string, ProjectManifest>>(new Map());
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

  function getManifest(modRoot: string): ProjectManifest | null {
    return manifests.value.get(modRoot) ?? null;
  }

  function getSessionId(modRoot: string): ProjectSessionId | null {
    return getManifest(modRoot)?.sessionId ?? null;
  }

  function removeProjectManifest(modRoot: string) {
    manifests.value.delete(modRoot);
  }

  function registerProjectManifest(manifest: ProjectManifest) {
    manifests.value.set(manifest.modRoot, manifest);
  }

  function replaceProjectManifest(manifest: ProjectManifest) {
    if (manifests.value.get(manifest.modRoot)?.sessionId !== manifest.sessionId) return;
    manifests.value.set(manifest.modRoot, manifest);
  }

  return {
    tableWriteTargets,
    manifests,
    getManifest,
    getSessionId,
    removeProjectManifest,
    registerProjectManifest,
    replaceProjectManifest,
  };
});
