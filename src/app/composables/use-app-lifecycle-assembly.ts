import { requestClose, readyNativeClose, replyNativeClose } from '@/services/app-lifecycle.service';
import { onUnmounted } from 'vue';
import { reloadCurrentWindow } from '@/windows/current.window';
import { refreshLoadedFileHistory } from '@/orchestrators/file-history-replay.orchestrator';
import { pauseProjectDisplay } from '@/orchestrators/project-sync.orchestrator';
import {
  flushSettings,
  withSettingsReset,
  startSettingsPersistence,
  startSettingsMirror,
} from '@/orchestrators/settings-persistence.orchestrator';
import { clearConfig } from '@/services/app-config.service';
import { provideWindowCloseState } from './use-window-close-state';
import { flushPerformanceMonitor, retainPerformanceMonitorError } from '@/app/performance-monitor';

export function useAppLifecycleAssembly() {
  return provideWindowCloseState({
    requestClose,
    readyClose: readyNativeClose,
    replyClose: replyNativeClose,
    prepareDisplay: pauseProjectDisplay,
    flushSettings: async () => {
      await flushSettings();
      await flushPerformanceMonitor()?.catch(retainPerformanceMonitorError);
    },
    clearConfig: () => withSettingsReset(clearConfig),
    reload: reloadCurrentWindow,
  });
}

export function useAppSettings(mode: 'main' | 'child') {
  onUnmounted(mode === 'main' ? startSettingsPersistence(refreshLoadedFileHistory) : startSettingsMirror());
}
