import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import type {
  JsonEditorPageId,
  GameOverviewData,
  GameScanWarning,
  ModEntry,
  ModOpeningFailure,
  PersistedWorkspace,
  CsvTableKey,
  WorkspaceColumnWidths,
  WorkspaceView,
  WorkspaceEntityLocation,
} from '@/shared/types';
import { gameModsDirectoryPath } from '@/shared/lib/paths';
import { isRowData } from '@/shared/lib/row-data';
import { useProjectStore } from '@/stores/project.store';

interface ModNavigationContext {
  jsonPage: JsonEditorPageId;
  currentView: Extract<WorkspaceView, 'mod-overview' | 'file-history' | 'json-editor' | 'table' | 'mod-files'>;
}

function createDefaultModNavigationContext(): ModNavigationContext {
  return { currentView: 'mod-overview', jsonPage: 'mod-info' };
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const project = useProjectStore();
  const mods = ref<Map<string, ModEntry>>(new Map());
  const modGenerations = new Map<string, number>();
  let nextModGeneration = 0;
  let workspaceGeneration = 0;
  const entityLocation = shallowRef<WorkspaceEntityLocation | null>(null);
  const activeModRoot = ref<string | null>(null);
  const currentView = ref<WorkspaceView>('overview');
  const jsonPage = ref<JsonEditorPageId>('mod-info');
  const modNavigationContexts = ref<Map<string, ModNavigationContext>>(new Map());
  const gameOverview = ref<GameOverviewData | null>(null);
  const modOpeningFailures = ref<Map<string, ModOpeningFailure>>(new Map());
  const columnWidths = ref<WorkspaceColumnWidths>({});

  const activeMod = computed(() => (activeModRoot.value ? (mods.value.get(activeModRoot.value) ?? null) : null));
  const activeManifest = computed(() => (activeModRoot.value ? project.getManifest(activeModRoot.value) : null));
  const activeSessionId = computed(() => activeManifest.value?.sessionId ?? null);
  const isModView = computed(() => ['mod-overview', 'file-history', 'json-editor', 'table', 'mod-files'].includes(currentView.value));
  const loadedModList = computed(() => [...mods.value.values()]);
  const referenceableModRoots = computed(() => {
    const ready = loadedModList.value.filter((mod) => mod.status === 'ready');
    const dependencyIds = new Set<string>();
    for (const mod of ready) {
      const dependencies = project.getManifest(mod.modRoot)?.modInfo?.dependencies;
      if (Array.isArray(dependencies))
        for (const dependency of dependencies)
          if (isRowData(dependency) && typeof dependency.id === 'string') dependencyIds.add(dependency.id);
    }
    return new Set(
      ready
        .filter((mod) => {
          const id = project.getManifest(mod.modRoot)?.modInfo?.id;
          return mod.referenceable ?? (typeof id === 'string' && dependencyIds.has(id));
        })
        .map((mod) => mod.modRoot),
    );
  });
  const loadedModCount = computed(() => mods.value.size);
  const hasLoadedMods = computed(() => mods.value.size > 0);
  const hasGameWorkspace = computed(() => gameOverview.value !== null);
  const modOpeningFailureList = computed(() => [...modOpeningFailures.value.values()]);
  const hasModOpeningFailures = computed(() => modOpeningFailures.value.size > 0);
  const hasWorkspaceContext = computed(() => hasGameWorkspace.value || hasLoadedMods.value);

  function registerMod(entry: ModEntry) {
    const generation = ++nextModGeneration;
    modGenerations.set(entry.modRoot, generation);
    mods.value.set(entry.modRoot, { ...entry });
    modNavigationContexts.value.set(entry.modRoot, createDefaultModNavigationContext());
    return generation;
  }

  function setModReferenceable(modRoot: string, referenceable: boolean | undefined) {
    const mod = mods.value.get(modRoot)!;
    if (referenceable === undefined) delete mod.referenceable;
    else mod.referenceable = referenceable;
  }

  function moveMod(modRoot: string, targetRoot: string, after: boolean) {
    const entries = loadedModList.value.filter((mod) => mod.modRoot !== modRoot);
    const target = entries.findIndex((mod) => mod.modRoot === targetRoot);
    entries.splice(target + Number(after), 0, mods.value.get(modRoot)!);
    mods.value = new Map(entries.map((mod) => [mod.modRoot, mod]));
  }

  function getModGeneration(modRoot: string): number | null {
    return modGenerations.get(modRoot) ?? null;
  }

  function getWorkspaceGeneration(): number {
    return workspaceGeneration;
  }

  function revokeWorkspaceGeneration(): number {
    workspaceGeneration += 1;
    return workspaceGeneration;
  }

  function setModOpeningFailure(failure: ModOpeningFailure) {
    modOpeningFailures.value.set(failure.modRoot, failure);
  }

  function clearModOpeningFailure(modRoot: string) {
    modOpeningFailures.value.delete(modRoot);
  }

  function clearModOpeningFailures() {
    modOpeningFailures.value.clear();
  }

  watch([activeModRoot, currentView, jsonPage, activeSessionId], () => {
    const location = entityLocation.value;
    if (
      location &&
      (location.sessionId !== activeSessionId.value ||
        location.modRoot !== activeModRoot.value ||
        (location.kind === 'ship'
          ? currentView.value !== 'table'
          : currentView.value !== 'json-editor' || jsonPage.value !== (location.kind === 'skin' ? 'skins' : 'variants')))
    )
      entityLocation.value = null;
  });
  function clearGameScanWarning(warning: GameScanWarning) {
    gameOverview.value!.warnings = gameOverview.value!.warnings.filter((item) => item !== warning);
  }

  function updateModStatus(modRoot: string, status: ModEntry['status'], error?: string) {
    const entry = mods.value.get(modRoot);
    if (!entry) return;
    entry.status = status;
    entry.error = error;
  }

  function updateModInfo(modRoot: string, displayName: string, version: string) {
    const entry = mods.value.get(modRoot);
    if (!entry) return;
    entry.displayName = displayName;
    entry.version = version;
  }

  function removeLoadedModEntry(modRoot: string) {
    modGenerations.delete(modRoot);
    mods.value.delete(modRoot);
    modNavigationContexts.value.delete(modRoot);
    cleanupColumnWidthsForMod(modRoot);
    if (activeModRoot.value === modRoot) {
      activeModRoot.value = null;
      currentView.value = 'overview';
      jsonPage.value = 'mod-info';
    }
  }

  function activateModOverview(modRoot: string) {
    if (!mods.value.has(modRoot)) return;
    activeModRoot.value = modRoot;
    currentView.value = 'mod-overview';
    updateModNavigationContext(modRoot, { currentView: 'mod-overview' });
  }

  function activateModFileHistory(modRoot: string) {
    if (!mods.value.has(modRoot)) return;
    activeModRoot.value = modRoot;
    currentView.value = 'file-history';
    updateModNavigationContext(modRoot, { currentView: 'file-history' });
  }

  function activateModTable(modRoot: string) {
    if (!mods.value.has(modRoot)) return;
    activeModRoot.value = modRoot;
    currentView.value = 'table';
    updateModNavigationContext(modRoot, { currentView: 'table' });
  }

  function activateModFiles(modRoot: string) {
    if (!mods.value.has(modRoot)) return;
    activeModRoot.value = modRoot;
    currentView.value = 'mod-files';
    updateModNavigationContext(modRoot, { currentView: 'mod-files' });
  }

  function activateModJson(modRoot: string, page: JsonEditorPageId) {
    if (!mods.value.has(modRoot)) return;
    activeModRoot.value = modRoot;
    currentView.value = 'json-editor';
    jsonPage.value = page;
    updateModNavigationContext(modRoot, { currentView: 'json-editor', jsonPage: page });
  }

  function activateModTab(modRoot: string) {
    if (!mods.value.has(modRoot)) return;
    const context = modNavigationContexts.value.get(modRoot) ?? createDefaultModNavigationContext();
    activeModRoot.value = modRoot;
    currentView.value = context.currentView;
    jsonPage.value = context.jsonPage;
  }

  function showOverview() {
    currentView.value = 'overview';
  }

  function showSettings() {
    currentView.value = 'settings';
  }

  function showAbout() {
    currentView.value = 'about';
  }

  function setGameOverview(overview: GameOverviewData | null, activateOverview = true) {
    gameOverview.value = overview;
    if (activateOverview) showOverview();
  }

  function isModImported(modRoot: string): boolean {
    return mods.value.has(modRoot);
  }

  function applyPersistedWorkspaceSnapshot(persisted: PersistedWorkspace) {
    clearModOpeningFailures();
    modNavigationContexts.value = new Map();
    for (const mod of persisted.mods) {
      registerMod({ ...mod, status: 'loading' });
    }
    activeModRoot.value = null;
    if (isModView.value) showOverview();
    jsonPage.value = 'mod-info';
    columnWidths.value = persisted.columnWidths;
    if (persisted.starsectorRoot) {
      gameOverview.value = {
        starsectorRoot: persisted.starsectorRoot,
        coreAvailable: true,
        modsDir: gameModsDirectoryPath(persisted.starsectorRoot),
        mods: persisted.gameMods,
        warnings: persisted.gameWarnings,
      };
    }
  }

  function toPersistedState(): PersistedWorkspace {
    return {
      mods: loadedModList.value
        .filter((m) => m.status !== 'error')
        .map((m) => ({
          modRoot: m.modRoot,
          displayName: m.displayName,
          version: m.version,
          ...(m.referenceable === undefined ? {} : { referenceable: m.referenceable }),
        })),
      starsectorRoot: gameOverview.value?.starsectorRoot ?? null,
      gameMods: gameOverview.value?.mods ?? [],
      gameWarnings: gameOverview.value?.warnings ?? [],
      columnWidths: columnWidths.value,
    };
  }

  function getColumnWidths(modRoot: string, table: CsvTableKey): Record<string, number> | undefined {
    return columnWidths.value[modRoot]?.[table];
  }

  function setColumnWidths(modRoot: string, table: CsvTableKey, widths: Record<string, number>) {
    columnWidths.value = {
      ...columnWidths.value,
      [modRoot]: {
        ...(columnWidths.value[modRoot] ?? {}),
        [table]: widths,
      },
    };
  }

  function cleanupColumnWidthsForMod(modRoot: string) {
    if (!columnWidths.value[modRoot]) return;
    const next = { ...columnWidths.value };
    delete next[modRoot];
    columnWidths.value = next;
  }

  function updateModNavigationContext(modRoot: string, next: Partial<ModNavigationContext>) {
    const previous = modNavigationContexts.value.get(modRoot) ?? createDefaultModNavigationContext();
    modNavigationContexts.value.set(modRoot, { ...previous, ...next });
  }

  return {
    entityLocation,
    activeModRoot,
    activeMod,
    activeManifest,
    activeSessionId,
    activateModTab,
    jsonPage,
    currentView,
    gameOverview,
    hasGameWorkspace,
    hasLoadedMods,
    hasModOpeningFailures,
    hasWorkspaceContext,
    loadedModCount,
    loadedModList,
    referenceableModRoots,
    modOpeningFailureList,
    modOpeningFailures,
    mods,
    activateModFileHistory,
    activateModJson,
    activateModFiles,
    activateModOverview,
    activateModTable,
    applyPersistedWorkspaceSnapshot,
    clearGameScanWarning,
    clearModOpeningFailure,
    clearModOpeningFailures,
    getColumnWidths,
    getModGeneration,
    getWorkspaceGeneration,
    isModImported,
    isModView,
    registerMod,
    setModReferenceable,
    moveMod,
    revokeWorkspaceGeneration,
    removeLoadedModEntry,
    setColumnWidths,
    setGameOverview,
    setModOpeningFailure,
    showAbout,
    showOverview,
    showSettings,
    toPersistedState,
    updateModInfo,
    updateModStatus,
  };
});
