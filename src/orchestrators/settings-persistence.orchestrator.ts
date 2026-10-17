import { nextTick, watch } from 'vue';
import { stableStringify } from '@/shared/lib/stable-compare';
import { recordLogBestEffort } from '@/services/app-log.service';
import { readSettings, saveSettings } from '@/services/app-settings.service';
import { useSettingsStore } from '@/stores/settings.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { listenWindowEvent } from '@/windows/tauri.events';
import { WINDOW_EVENTS } from '@/windows/window.events';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import type { AppSettings, SettingsSnapshot } from '@/shared/types';
let official: SettingsSnapshot | null = null;
let receive: ((snapshot: SettingsSnapshot) => void) | null = null;
let queue = Promise.resolve();
let saved = '';
let failure: unknown = null;
const pendingSnapshots = new Set<AppSettings>();
let generation = 0;
let paused = false;
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
  if (paused || (official && snapshot.revision <= official.revision)) return;
  official = snapshot;
  receive?.(snapshot);
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
  useTablesEditHistoryStore().setHistoryLimit(result.value.editHistoryLimit);
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
  useTablesEditHistoryStore().setHistoryLimit(settings.editHistoryLimit);
  const stop = watch(
    () => settings.settingsSnapshot(),
    (snapshot) => {
      if (
        !paused &&
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
    useTablesEditHistoryStore().setHistoryLimit(snapshot.value.editHistoryLimit);
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
export async function withSettingsReset(action: () => Promise<void>) {
  await flushSettings();
  paused = true;
  try {
    await action();
  } catch (error) {
    paused = false;
    throw error;
  }
}
