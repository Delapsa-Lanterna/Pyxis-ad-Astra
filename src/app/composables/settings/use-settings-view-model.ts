import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { computed, ref, onScopeDispose } from 'vue';
import { pickDirectoryDialog } from '@/shared/runtime/dialog.runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { clearLog, loadLogStatus } from '@/services/app-log.service';
import { applicationLogError } from '@/shared/runtime/app-log-queue';
import { useAppConfigActions } from '@/app/composables/settings/use-app-config-actions';
import { useSettingsStore } from '@/stores/settings.store';
import { saveLogDirectory, saveStarsectorRoot, resetSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { useWindowLifecycleActions } from '@/app/composables/use-window-close-state';
import { querySystemFonts } from '@/services/app-settings.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { controlPerformanceMonitor, performanceMonitorError } from '@/app/performance-monitor';
import type { AppLogStatus, PerformanceMonitorStatus } from '@/shared/types';

export function useSettingsViewModel(onReset?: () => void) {
  const settings = useSettingsStore();
  const { requestClose } = useWindowLifecycleActions();
  const feedback = useAppFeedback();
  const logSizeBytes = ref(0);
  const logPath = ref('');
  const logStatus = ref<AppLogStatus | null>(null);
  const formattedLogSize = computed(() => formatBytes(logSizeBytes.value));
  const logPathHint = computed(() => (logPath.value ? `Log 文件: ${logPath.value}` : 'Log 文件尚未创建。'));
  const configActions = useAppConfigActions();
  const reads = useQueryReadOwner();
  const monitorStatus = ref<PerformanceMonitorStatus | null>(null);
  const traceSeconds = ref(15);
  let traceRefresh: ReturnType<typeof setTimeout> | undefined;
  async function monitorAction(action: 'status' | 'reset' | 'export' | 'traceStart' | 'traceStop') {
    await reads.consume('monitor', { action }, () => controlPerformanceMonitor(action, traceSeconds.value), {
      ready: (status) => {
        monitorStatus.value = status;
        clearTimeout(traceRefresh);
        if (active && ['starting', 'finishing'].includes(status.traceState))
          traceRefresh = setTimeout(() => void monitorAction('status'), 300);
        if (active && status.traceState === 'recording')
          traceRefresh = setTimeout(
            () => void monitorAction('status'),
            Math.max(250, status.traceStartedAt + status.traceSeconds * 1000 - Date.now() + 200),
          );
      },
      error: (error) => feedback.error(error, '性能监视操作失败'),
    });
  }
  let active = true;
  onScopeDispose(() => {
    active = false;
    clearTimeout(traceRefresh);
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
      await changeStarsectorRoot(selected);
    }
  }

  async function changeStarsectorRoot(root: string | null) {
    try {
      await saveStarsectorRoot(root, requestClose);
    } catch (error) {
      feedback.error(error, '切换原版来源失败');
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

  async function pickImmersiveFontDirectory() {
    const selected = await pickDirectoryDialog('选择沉浸式字体目录');
    if (selected) settings.setImmersiveFontDirectory(selected);
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
        logStatus.value = status;
        logSizeBytes.value = status.sizeBytes;
        logPath.value = status.path;
      },
      error: (error) => feedback.error(error, '读取 log 状态失败'),
    });
  }

  function confirmResetSettings() {
    feedback.confirmDanger({
      title: '重置为默认配置？',
      content:
        '游戏目录、外观、字体、编辑偏好、缓存限制、日志及性能调试设置将恢复默认值。工作区记录、Mod 内容和已有日志继续保留。性能监视开关在重启后生效。',
      actionText: '重置',
      onConfirm: async () => {
        try {
          if (!(await resetSettings(requestClose))) return;
          if (active) onReset?.();
          feedback.success('已重置为默认配置');
          if (active) await refreshLogStatus();
        } catch (error) {
          feedback.error(error, '重置配置失败');
        }
      },
    });
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
            logStatus.value = status;
          }
          feedback.success('log 文件已清除');
        } catch (error) {
          feedback.error(error, '清除 log 文件失败');
        }
      },
    });
  }

  return {
    applicationLogError,
    monitorStatus,
    monitorAction,
    traceSeconds,
    performanceMonitorError,
    fontOptions,
    fontsLoading,
    loadSystemFonts,
    formattedLogSize,
    logPathHint,
    logStatus,
    pickLogDirectory,
    pickStarsectorRoot,
    changeStarsectorRoot,
    pickImmersiveFontDirectory,
    refreshLogStatus,
    openConfigFolderAction: configActions.openConfigFolderAction,
    restoreDefaultLogDirectory,
    confirmResetSettings,
    confirmClearLog,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
