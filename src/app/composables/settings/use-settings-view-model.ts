import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { computed, ref } from 'vue';
import { pickDirectoryDialog } from '@/shared/runtime/dialog.runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { clearLog, loadLogStatus, openLogFile } from '@/services/app-log.service';
import { useAppConfigActions } from '@/app/composables/settings/use-app-config-actions';
import { useSettingsStore } from '@/stores/settings.store';
import { saveLogDirectory } from '@/orchestrators/settings-persistence.orchestrator';
import { querySystemFonts } from '@/services/app-settings.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';

export function useSettingsViewModel() {
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const logSizeBytes = ref(0);
  const logPath = ref('');
  const formattedLogSize = computed(() => formatBytes(logSizeBytes.value));
  const logPathHint = computed(() => (logPath.value ? `Log 文件: ${logPath.value}` : 'Log 文件尚未创建。'));
  const configActions = useAppConfigActions(refreshLogStatus);
  const reads = useQueryReadOwner();
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
      await refreshLogStatus();
      feedback.success('日志输出目录已更新');
    } catch (error) {
      feedback.error(error, '保存日志输出目录失败');
    }
  }

  async function restoreDefaultLogDirectory() {
    try {
      await saveLogDirectory(null);
      await refreshLogStatus();
      feedback.success('日志输出目录已恢复默认位置');
    } catch (error) {
      feedback.error(error, '恢复默认日志输出目录失败');
    }
  }

  async function refreshLogStatus() {
    try {
      const status = await loadLogStatus();
      logSizeBytes.value = status.sizeBytes;
      logPath.value = status.path;
    } catch (error) {
      feedback.error(error, '读取 log 状态失败');
    }
  }

  async function openLogFileAction() {
    try {
      await openLogFile();
      await refreshLogStatus();
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
          const status = await clearLog();
          logSizeBytes.value = status.sizeBytes;
          logPath.value = status.path;
          feedback.success('log 文件已清除');
        } catch (error) {
          feedback.error(error, '清除 log 文件失败');
        }
      },
    });
  }

  return {
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
