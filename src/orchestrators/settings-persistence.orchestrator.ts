import { watch } from 'vue';
import { recordLogBestEffort } from '@/services/app-log.service';
import { saveSettings } from '@/services/app-settings.service';
import { useSettingsStore } from '@/stores/settings.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { listenWindowEvent, type UnlistenFn } from '@/windows/tauri.events';
import { WINDOW_EVENTS, type AppSettingsChangedEvent } from '@/windows/window.events';
import { publishWindowSettings, readWindowSettings, acceptWindowSettings } from '@/windows/window-context.window';
import { errorContextOf, errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';
import type { AppSettings } from '@/shared/types';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { refreshLoadedFileHistory } from '@/orchestrators/file-history-replay.orchestrator';

let started = false;
let mirrorStarted = false;
let skipPersistedSnapshot = false;
let saveQueue = Promise.resolve();
let logRequestId = 0;
let persistenceGeneration = 0;

const noopDispose = () => {};

export function startSettingsPersistence(): () => void {
  if (started) return noopDispose;
  started = true;
  const generation = ++persistenceGeneration;
  const settings = useSettingsStore();
  syncHistoryLimit(settings.editHistoryLimit);
  const stopWatch = watch(
    () => settings.settingsSnapshot(),
    (snapshot) => {
      if (skipPersistedSnapshot) {
        skipPersistedSnapshot = false;
        return;
      }
      syncHistoryLimit(snapshot.editHistoryLimit);
      void enqueueSettingsSave(() => persistSettingsSnapshot(settings, snapshot, () => generation === persistenceGeneration));
    },
    { deep: true },
  );
  return () => {
    stopWatch();
    started = false;
    persistenceGeneration++;
  };
}

export async function saveLogDirectory(directory: string | null): Promise<void> {
  const settings = useSettingsStore();
  const requestId = ++logRequestId;
  const generation = persistenceGeneration;
  await enqueueSettingsSave(async () => {
    const snapshot: AppSettings = { ...settings.settingsSnapshot(), logDirectory: directory };
    const saved = await saveSettings(snapshot);
    if (generation !== persistenceGeneration) return;
    settings.confirmSavedSettings(saved);
    if (requestId === logRequestId && settings.logDirectory !== saved.logDirectory) {
      skipPersistedSnapshot = true;
      settings.setLogDirectory(saved.logDirectory);
    }
    await broadcastSettingsSnapshot(saved);
    await refreshLoadedFileHistory(() => generation === persistenceGeneration);
  });
}

function enqueueSettingsSave(operation: () => Promise<void>): Promise<void> {
  const pending = saveQueue.then(operation);
  saveQueue = pending.catch(() => {});
  return pending;
}

export function startSettingsMirror(): () => void {
  if (mirrorStarted) return noopDispose;
  mirrorStarted = true;
  let disposed = false;
  const settings = useSettingsStore();
  syncHistoryLimit(settings.editHistoryLimit);
  const unlisteners: UnlistenFn[] = [];
  void listenWindowEvent<AppSettingsChangedEvent>(
    WINDOW_EVENTS.appSettingsChanged,
    (snapshot) => {
      if (disposed) return;
      if (!acceptWindowSettings(snapshot)) return;
      settings.replaceSettings(snapshot.value);
      syncHistoryLimit(snapshot.value.editHistoryLimit);
    },
    recordWindowEventHandlerError,
  )
    .then((unlisten) => {
      if (disposed) unlisten();
      else {
        unlisteners.push(unlisten);
        void readWindowSettings()
          .then((snapshot) => {
            if (disposed || !acceptWindowSettings(snapshot)) return;
            settings.replaceSettings(snapshot.value);
            syncHistoryLimit(snapshot.value.editHistoryLimit);
          })
          .catch((error) => recordWindowEventHandlerError(error, WINDOW_EVENTS.appSettingsChanged));
      }
    })
    .catch((error: unknown) => {
      if (disposed) return;
      const diagnostic = errorDiagnosticOf(error);
      recordLogBestEffort({
        level: 'error',
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.location?.path ?? null,
        line: diagnostic.location?.line ?? null,
        fields: logFields({ ...errorContextOf(error), action: 'settings-listen', column: diagnostic.location?.column }),
      });
    });
  return () => {
    disposed = true;
    mirrorStarted = false;
    for (const unlisten of unlisteners) unlisten();
  };
}

function syncHistoryLimit(limit: number): void {
  useTablesEditHistoryStore().setHistoryLimit(limit);
}

async function persistSettingsSnapshot(
  settings: ReturnType<typeof useSettingsStore>,
  snapshot: AppSettings,
  accepts: () => boolean,
): Promise<void> {
  try {
    const saved = await saveSettings(snapshot);
    if (!accepts()) return;
    settings.confirmSavedSettings(saved);
    await broadcastSettingsSnapshot(saved);
    await refreshLoadedFileHistory(accepts);
  } catch (error) {
    if (!accepts()) return;
    const diagnostic = errorDiagnosticOf(error);
    recordLogBestEffort({
      level: 'error',
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.location?.path ?? null,
      line: diagnostic.location?.line ?? null,
      fields: logFields({ ...errorContextOf(error), action: 'settings-save', column: diagnostic.location?.column }),
    });
    return;
  }
  recordLogBestEffort({ level: 'debug', code: 'settings.saved', message: 'settings saved', path: null, line: null, fields: null });
}

async function broadcastSettingsSnapshot(snapshot: AppSettings): Promise<void> {
  try {
    await publishWindowSettings(snapshot);
  } catch (error) {
    const diagnostic = errorDiagnosticOf(error);
    recordLogBestEffort({
      level: 'error',
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.location?.path ?? null,
      line: diagnostic.location?.line ?? null,
      fields: logFields({ ...errorContextOf(error), action: 'settings-broadcast', column: diagnostic.location?.column }),
    });
  }
}
