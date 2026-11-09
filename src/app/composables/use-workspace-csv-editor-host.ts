import { computed, onScopeDispose } from 'vue';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { navigateToModTable, navigateToModJson } from '@/orchestrators/workspace-navigation.orchestrator';
import { dispatchWorkspaceHistoryCommand } from '@/orchestrators/workspace-history.orchestrator';
import type { CsvEditorHost } from './csv-editor/csv-editor-context';
import type { CsvTableTarget } from '@/shared/types';
export function useWorkspaceCsvEditorHost(getConfiguredGameRoot: () => string | null): CsvEditorHost {
  const workspace = useWorkspaceStore(),
    tables = useCsvEditorStore();
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  const manifest = computed(() => (workspace.currentView === 'table' ? workspace.activeManifest : null));
  const target = computed<CsvTableTarget | null>(() => {
    const current = manifest.value;
    const state = current ? tables.getCsvModState(current.modRoot) : undefined;
    return current && state?.sessionId === current.sessionId
      ? { sessionId: current.sessionId, modRoot: current.modRoot, table: state.currentTab }
      : null;
  });
  const starsectorRoot = computed(
    () => manifest.value?.starsectorRoot ?? workspace.gameOverview?.starsectorRoot ?? getConfiguredGameRoot(),
  );
  const columnWidths = computed(() => (target.value ? (workspace.getColumnWidths(target.value.modRoot, target.value.table) ?? {}) : {}));
  const entityLocation = computed(() => workspace.entityLocation);
  const matches = (captured: CsvTableTarget) =>
    !disposed &&
    target.value?.sessionId === captured.sessionId &&
    target.value.modRoot === captured.modRoot &&
    target.value.table === captured.table;
  const setColumnWidth: CsvEditorHost['setColumnWidth'] = (captured, column, width) => {
    if (matches(captured))
      workspace.setColumnWidths(captured.modRoot, captured.table, {
        ...workspace.getColumnWidths(captured.modRoot, captured.table),
        [column]: width,
      });
  };
  const cancelEntityLocation: CsvEditorHost['cancelEntityLocation'] = (location) => {
    if (!disposed && workspace.entityLocation === location) workspace.entityLocation = null;
  };
  const completeEntityLocation: CsvEditorHost['completeEntityLocation'] = (location) => {
    if (target.value?.table === 'ships' && location.kind === 'ship' && matches({ ...location, table: 'ships' }))
      cancelEntityLocation(location);
  };
  const locateWingReference: CsvEditorHost['locateWingReference'] = (origin, location) => {
    if (!matches({ ...origin, table: 'wings' }) || tables.getCsvModState(origin.modRoot)!.selectedRowKey !== origin.rowKey) return;
    if (location.kind === 'ship') navigateToModTable(origin.modRoot, 'ships');
    else navigateToModJson(origin.modRoot, location.kind === 'skin' ? 'skins' : 'variants');
    workspace.entityLocation = { sessionId: origin.sessionId, modRoot: origin.modRoot, ...location };
  };
  return {
    target,
    manifest,
    starsectorRoot,
    columnWidths,
    entityLocation,
    dispatchHistoryCommand: dispatchWorkspaceHistoryCommand,
    setColumnWidth,
    completeEntityLocation,
    cancelEntityLocation,
    locateWingReference,
  };
}
