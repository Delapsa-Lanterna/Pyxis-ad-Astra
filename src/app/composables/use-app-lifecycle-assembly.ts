import { requestClose, readyNativeClose, replyNativeClose } from '@/services/app-lifecycle.service';
import { onUnmounted, onScopeDispose } from 'vue';
import { refreshLoadedFileHistory } from '@/orchestrators/file-history-replay.orchestrator';
import { pauseProjectDisplay, startProjectSync } from '@/orchestrators/project-sync.orchestrator';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { acceptReleasedSessions } from '@/orchestrators/workspace-lifecycle.orchestrator';
import { flushSettings, startSettingsPersistence, startSettingsMirror } from '@/orchestrators/settings-persistence.orchestrator';
import { provideWindowCloseState } from './use-window-close-state';
import { flushPerformanceMonitor, retainPerformanceMonitorError } from '@/app/performance-monitor';
import { flushApplicationLogs } from '@/services/app-log.service';
import { debugLog } from '@/shared/runtime/app-log-queue';
import type { AppFeedback } from '@/shared/types';

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
  return provideWindowCloseState({
    requestClose,
    readyClose: readyNativeClose,
    replyClose: replyNativeClose,
    prepareDisplay: pauseProjectDisplay,
    acceptReleasedSessions,
    flushPerformance,
    flushSettings: async () => {
      await flushSettings();
      debugLog('window.close_prepared');
      await flushApplicationLogs();
      await flushPerformance();
    },
  });
}

export function useAppSettings(mode: 'main' | 'child') {
  onUnmounted(mode === 'main' ? startSettingsPersistence(refreshLoadedFileHistory) : startSettingsMirror());
}
