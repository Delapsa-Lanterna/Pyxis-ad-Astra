import { requestClose, readyNativeClose, replyNativeClose } from '@/services/app-lifecycle.service';
import { onUnmounted } from 'vue';
import { refreshLoadedFileHistory } from '@/orchestrators/file-history-replay.orchestrator';
import { pauseProjectDisplay } from '@/orchestrators/project-sync.orchestrator';
import { flushSettings, startSettingsPersistence, startSettingsMirror } from '@/orchestrators/settings-persistence.orchestrator';
import { provideWindowCloseState } from './use-window-close-state';
import { flushPerformanceMonitor, retainPerformanceMonitorError } from '@/app/performance-monitor';
import { flushApplicationLogs } from '@/services/app-log.service';
import { debugLog } from '@/shared/runtime/app-log-queue';

export function useAppLifecycleAssembly() {
  return provideWindowCloseState({
    requestClose,
    readyClose: readyNativeClose,
    replyClose: replyNativeClose,
    prepareDisplay: pauseProjectDisplay,
    flushSettings: async () => {
      await flushSettings();
      debugLog('window.close_prepared');
      await flushApplicationLogs();
      await flushPerformanceMonitor()?.catch(retainPerformanceMonitorError);
    },
  });
}

export function useAppSettings(mode: 'main' | 'child') {
  onUnmounted(mode === 'main' ? startSettingsPersistence(refreshLoadedFileHistory) : startSettingsMirror());
}
