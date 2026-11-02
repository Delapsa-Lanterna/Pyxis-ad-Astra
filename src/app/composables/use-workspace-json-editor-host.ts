import { computed, onScopeDispose } from 'vue';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import type { JsonEditorHost, JsonEditorPageTarget } from './json-editor/json-editor-context';

export function useWorkspaceJsonEditorHost(): JsonEditorHost {
  const workspace = useWorkspaceStore();
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  const pageTarget = computed<JsonEditorPageTarget | null>(() => {
    const manifest = workspace.activeManifest;
    return workspace.currentView === 'json-editor' && manifest
      ? { sessionId: manifest.sessionId, modRoot: manifest.modRoot, page: workspace.jsonPage }
      : null;
  });
  const entityLocation = computed(() => workspace.entityLocation);
  const completeEntityLocation: JsonEditorHost['completeEntityLocation'] = (location) => {
    const target = pageTarget.value;
    if (
      !disposed &&
      workspace.entityLocation === location &&
      target?.sessionId === location.sessionId &&
      target.modRoot === location.modRoot &&
      target.page === (location.kind === 'skin' ? 'skins' : 'variants')
    )
      workspace.entityLocation = null;
  };
  const locateBaseHull: JsonEditorHost['locateBaseHull'] = (origin, hull) => {
    const target = pageTarget.value;
    if (disposed || target?.page !== 'skins' || target.sessionId !== origin.sessionId || target.modRoot !== origin.modRoot) return;
    navigateToModTable(origin.modRoot, 'ships');
    workspace.entityLocation = { sessionId: origin.sessionId, modRoot: origin.modRoot, kind: 'ship', ...hull };
  };
  return { pageTarget, entityLocation, completeEntityLocation, locateBaseHull };
}
