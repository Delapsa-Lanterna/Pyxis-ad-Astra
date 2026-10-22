import { useWindowLifecycleActions } from '@/app/composables/use-window-close-state';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { computed, ref, onScopeDispose } from 'vue';
import { pickDirectoryDialog } from '@/shared/runtime/dialog.runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { clearLog, loadLogStatus, openLogFile } from '@/services/app-log.service';
import { useAppConfigActions } from '@/app/composables/settings/use-app-config-actions';
import { useSettingsStore } from '@/stores/settings.store';
import { saveLogDirectory } from '@/orchestrators/settings-persistence.orchestrator';
import { querySystemFonts } from '@/services/app-settings.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { controlPerformanceMonitor, performanceMonitorError } from '@/app/performance-monitor';
import type { PerformanceMonitorStatus } from '@/shared/types';

export function useSettingsViewModel(closeWorkspace: () => Promise<boolean>) {
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const logSizeBytes = ref(0);
  const logPath = ref('');
  const formattedLogSize = computed(() => formatBytes(logSizeBytes.value));
  const logPathHint = computed(() => (logPath.value ? `Log 文件: ${logPath.value}` : 'Log 文件尚未创建。'));
  const configActions = useAppConfigActions(closeWorkspace, useWindowLifecycleActions());
  const reads = useQueryReadOwner();
  const monitorStatus = ref<PerformanceMonitorStatus | null>(null);
  async function monitorAction(action: 'status' | 'reset' | 'export') {
    await reads.consume('monitor', { action }, () => controlPerformanceMonitor(action), {
      ready: (status) => {
        monitorStatus.value = status;
      },
      error: (error) => feedback.error(error, '性能监视操作失败'),
    });
  }
  let active = true;
  onScopeDispose(() => {
    active = false;
  });
  const systemFonts = ref<string[]>([]);
  const fontsLoading = ref(false);
  const fontOptions = computed(() => [
    { label: '默认字体组合', value: '' },
    ...systemFonts.value.map((font) => ({ label: font, value: font })),
  ]);

  async function loadSystemFonts() {
    fontsLoading.value = true;
    await reads.consume('system-fonts', {}, querySystemFonts, {
      ready: (fonts) => {
        systemFonts.value = fonts;
      },
      error: (error) => feedback.error(error, '读取系统字体失败'),
      settled: () => {
        fontsLoading.value = false;
      },
    });
  }

  useContextMenuScope({ identity: () => 'settings', refresh: () => Promise.all([loadSystemFonts(), refreshLogStatus()]) });

  async function pickStarsectorRoot() {
    const selected = await pickDirectoryDialog('选择 Starsector 安装目录');
    if (selected) {
      settings.setStarsectorRoot(selected);
    }
  }

  async function pickLogDirectory() {
    const selected = await pickDirectoryDialog('选择日志输出目录');
    if (!selected || typeof selected !== 'string') return;
    try {
      await saveLogDirectory(selected);
      feedback.success('日志输出目录已更新');
      if (active) await refreshLogStatus();
    } catch (error) {
      feedback.error(error, '保存日志输出目录失败');
    }
  }

  async function restoreDefaultLogDirectory() {
    try {
      await saveLogDirectory(null);
      feedback.success('日志输出目录已恢复默认位置');
      if (active) await refreshLogStatus();
    } catch (error) {
      feedback.error(error, '恢复默认日志输出目录失败');
    }
  }

  async function refreshLogStatus() {
    await reads.consume('log-status', {}, loadLogStatus, {
      ready: (status) => {
        logSizeBytes.value = status.sizeBytes;
        logPath.value = status.path;
      },
      error: (error) => feedback.error(error, '读取 log 状态失败'),
    });
  }

  async function openLogFileAction() {
    try {
      await openLogFile();
      if (active) await refreshLogStatus();
    } catch (error) {
      feedback.error(error, '打开 log 文件失败');
    }
  }

  function confirmClearLog() {
    feedback.confirmDanger({
      title: '清除 log 文件',
      content: '将清空当前 log 文件内容。确认清除？',
      actionText: '清除',
      onConfirm: async () => {
        try {
          reads.revoke('consumer', 'log-status');
          const status = await clearLog();
          if (active) {
            reads.revoke('consumer', 'log-status');
            logSizeBytes.value = status.sizeBytes;
            logPath.value = status.path;
          }
          feedback.success('log 文件已清除');
        } catch (error) {
          feedback.error(error, '清除 log 文件失败');
        }
      },
    });
  }

  return {
    monitorStatus,
    monitorAction,
    performanceMonitorError,
    fontOptions,
    fontsLoading,
    loadSystemFonts,
    formattedLogSize,
    logPathHint,
    pickLogDirectory,
    pickStarsectorRoot,
    refreshLogStatus,
    openConfigFolderAction: configActions.openConfigFolderAction,
    openLogFileAction,
    restoreDefaultLogDirectory,
    confirmClearConfig: configActions.confirmClearConfig,
    confirmClearLog,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
