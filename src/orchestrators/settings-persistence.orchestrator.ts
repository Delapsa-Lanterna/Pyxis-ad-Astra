import { nextTick, watch } from 'vue';
import { stableStringify } from '@/shared/lib/stable-compare';
import { recordLogBestEffort } from '@/services/app-log.service';
import { appLogQueue, debugLog } from '@/shared/runtime/app-log-queue';
import { listenSettingsChanged, readSettings, readDefaultSettings, saveSettings } from '@/services/app-settings.service';
import { useSettingsStore } from '@/stores/settings.store';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import { invalidatedRead } from '@/shared/runtime/read-request';
import type { AppSettings, SettingsSnapshot } from '@/shared/types';
import { updateCacheLimits } from '@/shared/runtime/cache-limits';
type ChangeSource = (root: string | null, commitSettings: () => Promise<void>) => Promise<boolean>;
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
  let active = true;
  let stop: (() => void) | null = null;
  const acceptCurrent = (snapshot: SettingsSnapshot) => {
    if (active) accept(snapshot);
  };
  const reportCurrent = (error: unknown) => {
    if (active) report(error);
  };
  const refresh = () => {
    void readSettings().then(acceptCurrent).catch(reportCurrent);
  };
  const release = () => {
    active = false;
    stop?.();
    stop = null;
    window.removeEventListener('pagehide', release);
    window.removeEventListener('focus', refresh);
    receive = null;
  };
  window.addEventListener('pagehide', release, { once: true });
  try {
    stop = await listenSettingsChanged(acceptCurrent, reportCurrent);
    if (!active) {
      release();
      throw invalidatedRead({ kind: 'settings-startup' }, 'consumer');
    }
    window.addEventListener('focus', refresh);
    const snapshot = await readSettings();
    if (!active) throw invalidatedRead({ kind: 'settings-startup' }, 'consumer');
    accept(snapshot);
    return official!;
  } catch (error) {
    release();
    throw error;
  }
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
export async function saveStarsectorRoot(root: string | null, changeSource: ChangeSource, defaults?: AppSettings): Promise<boolean> {
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
  if (root !== official!.value.starsectorRoot) return changeSource(root, commit);
  await commit();
  return true;
}
export async function resetSettings(changeSource: ChangeSource): Promise<boolean> {
  const defaults = await readDefaultSettings();
  return saveStarsectorRoot(defaults.starsectorRoot, changeSource, defaults);
}
