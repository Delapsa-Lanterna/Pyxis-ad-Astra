import { nextTick, watch } from 'vue';
import { stableStringify } from '@/shared/lib/stable-compare';
import { recordLogBestEffort } from '@/services/app-log.service';
import { appLogQueue, debugLog } from '@/shared/runtime/app-log-queue';
import { readSettings, readDefaultSettings, saveSettings } from '@/services/app-settings.service';
import { useSettingsStore } from '@/stores/settings.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { listenWindowEvent } from '@/windows/tauri.events';
import { WINDOW_EVENTS } from '@/windows/window.events';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import type { AppSettings, SettingsSnapshot, CloseScope, CloseResult } from '@/shared/types';
import {
  captureWorkspaceCloseTarget,
  closeWorkspaceRuntime,
  removeLoadedModRuntime,
} from '@/orchestrators/workspace-lifecycle.orchestrator';
import { settleDirectoryOpenings } from '@/orchestrators/directory-opening.orchestrator';
import {
  beginWorkspaceRestore,
  finishWorkspaceRestore,
  restorePersistedWorkspace,
} from '@/orchestrators/workspace-persistence.orchestrator';
import { detectDirectoryTarget } from '@/services/directory.service';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { buildModOpeningFailure } from '@/domain/project/load-diagnostics';
import { updateCacheLimits } from '@/shared/runtime/cache-limits';
let official: SettingsSnapshot | null = null;
let receive: ((snapshot: SettingsSnapshot) => void) | null = null;
let queue = Promise.resolve();
let saved = '';
let failure: unknown = null;
const pendingSnapshots = new Set<AppSettings>();
let generation = 0;
let stopPersistence: (() => void) | null = null;
let committed: (accepts: () => boolean) => Promise<void>;
function report(error: unknown) {
  const diagnostic = errorDiagnosticOf(error);
  recordLogBestEffort({
    level: 'error',
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.location?.path ?? null,
    line: diagnostic.location?.line ?? null,
    fields: { action: 'settings' },
  });
}
function accept(snapshot: SettingsSnapshot) {
  if (official && snapshot.revision <= official.revision) return;
  official = snapshot;
  appLogQueue.setLevel(snapshot.value.logLevel);
  debugLog('settings.saved', () => ({ revision: String(snapshot.revision), level: snapshot.value.logLevel }));
  receive?.(snapshot);
  updateCacheLimits(snapshot.value.cacheLimits);
}
export async function initializeSettings(): Promise<SettingsSnapshot> {
  const stop = await listenWindowEvent<SettingsSnapshot>(WINDOW_EVENTS.appSettingsChanged, accept, report);
  const refresh = () => {
    void readSettings().then(accept).catch(report);
  };
  window.addEventListener('focus', refresh);
  window.addEventListener(
    'pagehide',
    () => {
      stop();
      window.removeEventListener('focus', refresh);
      receive = null;
    },
    { once: true },
  );
  accept(await readSettings());
  return official!;
}
function enqueue(operation: () => Promise<void>) {
  const pending = queue.then(operation);
  queue = pending.catch(() => {});
  return pending;
}
function mergeNormalized(current: AppSettings, snapshot: AppSettings, normalized: AppSettings): AppSettings {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      stableStringify(value) === stableStringify(snapshot[key as keyof AppSettings]) ? normalized[key as keyof AppSettings] : value,
    ]),
  ) as unknown as AppSettings;
}
function enqueueSave(snapshot: AppSettings, life: number) {
  pendingSnapshots.add(snapshot);
  return enqueue(async () => {
    pendingSnapshots.delete(snapshot);
    try {
      await persist(snapshot, life, committed);
      failure = null;
    } catch (error) {
      failure = error;
      throw error;
    }
  });
}
async function persist(snapshot: AppSettings, life: number, committed: (accepts: () => boolean) => Promise<void>) {
  const result = await saveSettings(snapshot);
  if (life !== generation) return;
  saved = stableStringify(result.value);
  const settings = useSettingsStore();
  const current = settings.settingsSnapshot();
  const merged = mergeNormalized(current, snapshot, result.value);
  for (const pending of pendingSnapshots) Object.assign(pending, mergeNormalized(pending, snapshot, result.value));
  settings.replaceSettings(merged);
  settings.confirmSavedSettings(result.value);
  useCsvEditorStore().setHistoryLimit(result.value.editHistoryLimit);
  accept(result);
  try {
    await committed(() => life === generation);
  } catch (error) {
    report(error);
  }
}
export function startSettingsPersistence(onCommitted: (accepts: () => boolean) => Promise<void>): () => void {
  if (stopPersistence) return () => {};
  committed = onCommitted;
  const life = ++generation;
  const settings = useSettingsStore();
  saved = stableStringify(official?.value ?? settings.settingsSnapshot());
  receive = (snapshot) => {
    settings.confirmSavedSettings(snapshot.value);
  };
  useCsvEditorStore().setHistoryLimit(settings.editHistoryLimit);
  const stop = watch(
    () => settings.settingsSnapshot(),
    (snapshot) => {
      if (
        stableStringify(snapshot) !== saved &&
        ![...pendingSnapshots].some((pending) => stableStringify(pending) === stableStringify(snapshot))
      )
        void enqueueSave(snapshot, life).catch(report);
    },
    { deep: true },
  );
  stopPersistence = () => {
    stop();
    receive = null;
    stopPersistence = null;
    generation++;
  };
  return stopPersistence;
}
export function startSettingsMirror(): () => void {
  const settings = useSettingsStore();
  receive = (snapshot) => {
    settings.replaceSettings(snapshot.value);
    settings.confirmSavedSettings(snapshot.value);
    useCsvEditorStore().setHistoryLimit(snapshot.value.editHistoryLimit);
  };
  if (official) receive(official);
  return () => {
    receive = null;
  };
}
export async function saveLogDirectory(directory: string | null): Promise<void> {
  const settings = useSettingsStore();
  settings.setLogDirectory(directory);
  await flushSettings();
}
export async function flushSettings(): Promise<void> {
  const life = generation;
  for (;;) {
    await nextTick();
    const pending = queue;
    await pending;
    if (failure) {
      const error = failure;
      failure = null;
      throw error;
    }
    if (life !== generation) throw new AppError('设置保存生命周期已变化', { action: 'settings-close' });
    if (pending !== queue) continue;
    const snapshot = useSettingsStore().settingsSnapshot();
    if (stableStringify(snapshot) === saved) return;
    await enqueueSave(snapshot, life).catch((error) => {
      failure = null;
      throw error;
    });
  }
}
export async function saveStarsectorRoot(
  root: string | null,
  requestClose: (scope: CloseScope) => Promise<CloseResult>,
  defaults?: AppSettings,
): Promise<boolean> {
  const settings = useSettingsStore();
  await flushSettings();
  const commit = async () => {
    const previousRoot = official!.value.starsectorRoot;
    if (defaults) settings.replaceSettings(defaults);
    else settings.setStarsectorRoot(root);
    try {
      await flushSettings();
    } catch (error) {
      settings.setStarsectorRoot(previousRoot);
      throw error;
    }
  };
  if (root !== official!.value.starsectorRoot) return switchCoreSource(root, requestClose, commit);
  await commit();
  return true;
}
export async function resetSettings(requestClose: (scope: CloseScope) => Promise<CloseResult>): Promise<boolean> {
  const defaults = await readDefaultSettings();
  return saveStarsectorRoot(defaults.starsectorRoot, requestClose, defaults);
}

async function switchCoreSource(
  root: string | null,
  requestClose: (scope: CloseScope) => Promise<CloseResult>,
  commitSettings: () => Promise<void>,
) {
  await useSaveCommandStore().settleCloseActions();
  await settleDirectoryOpenings();
  if (root && (await detectDirectoryTarget(root, null)).kind !== 'game-root')
    throw new AppError(`请选择 Starsector 游戏安装目录: ${root}`, { action: 'core-source' });
  const workspace = useWorkspaceStore();
  const snapshot = workspace.toPersistedState();
  beginWorkspaceRestore();
  try {
    if (!(await closeWorkspaceRuntime(captureWorkspaceCloseTarget(), requestClose))) return false;
    // Track only the post-close work: close preparation waits for tracked actions.
    await useSaveCommandStore().trackCloseAction(commitAndReopen());
    return true;
  } finally {
    await finishWorkspaceRestore();
  }
  async function commitAndReopen() {
    try {
      await commitSettings();
    } finally {
      await restorePersistedWorkspace(
        {
          onModRestoreError: async (modRoot, _name, error) => {
            await removeLoadedModRuntime(modRoot, requestClose);
            workspace.setModOpeningFailure(buildModOpeningFailure(modRoot, error));
          },
        },
        snapshot,
      );
    }
  }
}
