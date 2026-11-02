import { requestClose, readyNativeClose, replyNativeClose } from '@/services/app-lifecycle.service';
import { onUnmounted, onScopeDispose, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { refreshLoadedFileHistory } from '@/orchestrators/file-history-replay.orchestrator';
import { pauseProjectDisplay, startProjectSync } from '@/orchestrators/project-sync.orchestrator';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { acceptReleasedSessions } from '@/orchestrators/workspace-lifecycle.orchestrator';
import { flushSettings, startSettingsPersistence, startSettingsMirror } from '@/orchestrators/settings-persistence.orchestrator';
import { provideWindowCloseState } from './use-window-close-state';
import { provideAppCloseActions, useAppCloseParticipant } from './use-app-close-participant';
import { flushPerformanceMonitor, retainPerformanceMonitorError } from '@/app/performance-monitor';
import { flushApplicationLogs } from '@/services/app-log.service';
import { managedWindowContext } from '@/windows/window-context.window';
import { logIdentity } from '@/shared/lib/log-fields';
import { debugLog } from '@/shared/runtime/app-log-queue';
import type { AppFeedback } from '@/shared/types';
import { createModSaveCoordinator } from '@/orchestrators/mod-save.orchestrator';
import { useWindowShortcuts } from './use-window-shortcuts';

async function flushPerformance() {
  await flushPerformanceMonitor()?.catch(retainPerformanceMonitorError);
}

export function useAppLifecycleAssembly(feedback: AppFeedback) {
  let disposed = false;
  let stopSync: (() => void) | null = null;
  void startProjectSync(feedback)
    .then((stop) => {
      if (disposed) stop();
      else stopSync = stop;
    })
    .catch((error) => recordWindowEventHandlerError(error, 'save-registration'));
  onScopeDispose(() => {
    disposed = true;
    stopSync?.();
  });
  provideAppCloseActions({
    readyClose: readyNativeClose,
    replyClose: replyNativeClose,
    prepareDisplay: pauseProjectDisplay,
    acceptReleasedSessions,
    flushPerformance,
    flushSettings: async () => {
      await flushSettings();
      debugLog('window.close_prepared', () => logIdentity(managedWindowContext.value));
      await flushApplicationLogs();
      await flushPerformance();
    },
  });
  const closing = provideWindowCloseState({ requestClose, createParticipant: useAppCloseParticipant });
  const modSave = createModSaveCoordinator(feedback, () => closing.value);
  void modSave.ready.catch((error) => feedback.error(error, '登记 Mod 保存入口失败'));
  useWindowShortcuts({ commands: { saveMod: () => void modSave.save() } });
  onScopeDispose(modSave.dispose);
  return closing;
}

export function useAppSettings(mode: 'main' | 'child') {
  const settings = useSettingsStore();
  const csv = useCsvEditorStore();
  watch(() => settings.editHistoryLimit, csv.setHistoryLimit, { immediate: true, flush: 'sync' });
  onUnmounted(mode === 'main' ? startSettingsPersistence(refreshLoadedFileHistory) : startSettingsMirror());
}
