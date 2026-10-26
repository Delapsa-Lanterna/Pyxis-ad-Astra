import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
  pickDirectoryDialog: vi.fn(async () => null as string | null),
  saveLogDirectory: vi.fn(async () => {}),
  loadLogStatus: vi.fn(async () => ({ path: 'C:/log/app.log', sizeBytes: 0 })),
  openConfigFolder: vi.fn(async () => {}),
  resetSettings: vi.fn(async () => {}),
  clearLog: vi.fn(async () => ({ path: 'C:/log/app.log', sizeBytes: 0 })),
  querySystemFonts: vi.fn(async () => ['Arial', 'Microsoft YaHei']),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickDirectoryDialog: mocks.pickDirectoryDialog,
}));

vi.mock('@/services/app-log.service', () => ({
  loadLogStatus: mocks.loadLogStatus,
  clearLog: mocks.clearLog,
}));

vi.mock('@/services/app-config.service', () => ({ openConfigFolder: mocks.openConfigFolder }));
vi.mock('@/services/app-settings.service', () => ({ querySystemFonts: mocks.querySystemFonts }));

vi.mock('@/orchestrators/settings-persistence.orchestrator', () => ({
  saveLogDirectory: mocks.saveLogDirectory,
  resetSettings: mocks.resetSettings,
}));

import { useSettingsViewModel } from './use-settings-view-model';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';

describe('useSettingsViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    vi.clearAllMocks();
  });

  it('loads installed families while retaining the default combination', async () => {
    const scope = effectScope();
    const viewModel = scope.run(() => useSettingsViewModel())!;
    const loading = viewModel.loadSystemFonts();
    expect(viewModel.fontsLoading.value).toBe(true);
    await loading;
    expect(viewModel.fontsLoading.value).toBe(false);
    expect(viewModel.fontOptions.value).toEqual([
      { label: '默认字体组合', value: '' },
      { label: 'Arial', value: 'Arial' },
      { label: 'Microsoft YaHei', value: 'Microsoft YaHei' },
    ]);
    scope.stop();
  });

  it.each(['success', 'error'] as const)('releases late installed-font %s after leaving settings', async (result) => {
    let resolve!: (fonts: string[]) => void;
    let reject!: (error: Error) => void;
    mocks.querySystemFonts.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    const scope = effectScope();
    const viewModel = scope.run(() => useSettingsViewModel())!;
    const loading = viewModel.loadSystemFonts();
    scope.stop();
    if (result === 'success') resolve(['Arial']);
    else reject(new Error('late enumeration'));
    await loading;
    expect(viewModel.fontOptions.value).toEqual([{ label: '默认字体组合', value: '' }]);
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });

  it('reports enumeration failures and finishes loading', async () => {
    mocks.querySystemFonts.mockRejectedValueOnce(new Error('enumeration failed'));
    const scope = effectScope();
    const viewModel = scope.run(() => useSettingsViewModel())!;
    await viewModel.loadSystemFonts();
    expect(viewModel.fontsLoading.value).toBe(false);
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.any(Error), '读取系统字体失败');
    scope.stop();
  });

  it('formats log sizes in bytes, kilobytes and megabytes', async () => {
    const viewModel = useSettingsViewModel();
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 512 });
    await viewModel.refreshLogStatus();
    expect(viewModel.formattedLogSize.value).toBe('512 B');

    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 2048 });
    await viewModel.refreshLogStatus();
    expect(viewModel.formattedLogSize.value).toBe('2.0 KB');

    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 3 * 1024 * 1024 });
    await viewModel.refreshLogStatus();
    expect(viewModel.formattedLogSize.value).toBe('3.0 MB');
  });

  it('hints about the log path once a status is loaded', async () => {
    const viewModel = useSettingsViewModel();
    expect(viewModel.logPathHint.value).toContain('尚未创建');
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 10 });
    await viewModel.refreshLogStatus();
    expect(viewModel.logPathHint.value).toBe('Log 文件: C:/log/app.log');
  });

  it('stores a picked starsector root in the settings store', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue('D:/games/starsector');
    const viewModel = useSettingsViewModel();
    await viewModel.pickStarsectorRoot();
    expect(useSettingsStore().starsectorRoot).toBe('D:/games/starsector');
  });

  it('ignores a cancelled starsector directory pick', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue(null);
    const viewModel = useSettingsViewModel();
    await viewModel.pickStarsectorRoot();
    expect(useSettingsStore().starsectorRoot).toBeNull();
  });
  it('persists a picked log directory and refreshes the status', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue('C:/custom-log');
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/custom-log/app.log', sizeBytes: 0 });
    const viewModel = useSettingsViewModel();
    await viewModel.pickLogDirectory();
    expect(mocks.saveLogDirectory).toHaveBeenCalledWith('C:/custom-log');
    expect(mocks.feedback.success).toHaveBeenCalledWith('日志输出目录已更新');
    expect(viewModel.logPathHint.value).toContain('C:/custom-log');
  });

  it('reports log directory save failures', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue('C:/custom-log');
    mocks.saveLogDirectory.mockRejectedValue(new Error('denied'));
    const viewModel = useSettingsViewModel();
    await viewModel.pickLogDirectory();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
  });

  it('restores the default log directory', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue(null);
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 0 });
    mocks.saveLogDirectory.mockResolvedValue(createSettingsFixture() as never);
    const viewModel = useSettingsViewModel();
    await viewModel.restoreDefaultLogDirectory();
    expect(mocks.saveLogDirectory).toHaveBeenCalledWith(null);
    expect(mocks.feedback.success).toHaveBeenCalledWith('日志输出目录已恢复默认位置');
  });

  it('confirms a settings reset and reports completion after leaving the page', async () => {
    const onReset = vi.fn();
    let finish!: () => void;
    mocks.resetSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const scope = effectScope();
    const viewModel = scope.run(() => useSettingsViewModel(onReset))!;
    viewModel.confirmResetSettings();
    expect(mocks.feedback.confirmDanger).toHaveBeenCalledTimes(1);
    expect(mocks.resetSettings).not.toHaveBeenCalled();
    const resetting = mocks.feedback.confirmDanger.mock.calls[0]![0].onConfirm();
    scope.stop();
    finish();
    await resetting;
    expect(mocks.resetSettings).toHaveBeenCalledOnce();
    expect(mocks.feedback.success).toHaveBeenCalledWith('已重置为默认配置');
    expect(onReset).not.toHaveBeenCalled();
    expect(mocks.loadLogStatus).not.toHaveBeenCalled();
  });
  it('refreshes the log location after resetting settings', async () => {
    const scope = effectScope();
    const viewModel = scope.run(() => useSettingsViewModel())!;
    viewModel.confirmResetSettings();
    await mocks.feedback.confirmDanger.mock.calls[0]![0].onConfirm();
    expect(mocks.resetSettings).toHaveBeenCalledOnce();
    expect(viewModel.logPathHint.value).toBe('Log 文件: C:/log/app.log');
    scope.stop();
  });
  it('reports a settings reset failure', async () => {
    mocks.resetSettings.mockRejectedValueOnce(new Error('configuration is locked'));
    const scope = effectScope();
    const viewModel = scope.run(() => useSettingsViewModel())!;
    viewModel.confirmResetSettings();
    await mocks.feedback.confirmDanger.mock.calls[0]![0].onConfirm();
    expect(mocks.feedback.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '重置配置失败');
    expect(mocks.feedback.success).not.toHaveBeenCalled();
    scope.stop();
  });

  it('clears the log file behind a danger confirmation', async () => {
    mocks.clearLog.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 0 });
    const viewModel = useSettingsViewModel();
    viewModel.confirmClearLog();
    await mocks.feedback.confirmDanger.mock.calls[0]![0].onConfirm();
    expect(mocks.clearLog).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.success).toHaveBeenCalledWith('log 文件已清除');
    expect(viewModel.formattedLogSize.value).toBe('0 B');
  });

  it('reports a failure to open the config directory', async () => {
    mocks.openConfigFolder.mockRejectedValue(new Error('gone'));
    const viewModel = useSettingsViewModel();
    await viewModel.openConfigFolderAction();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
  });

  it('accepts only the newest log status and releases page reads on navigation', async () => {
    let finish!: (value: { path: string; sizeBytes: number }) => void;
    mocks.loadLogStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const scope = effectScope();
    const vm = scope.run(() => useSettingsViewModel())!;
    const old = vm.refreshLogStatus();
    mocks.loadLogStatus.mockResolvedValueOnce({ path: 'C:/latest/app.log', sizeBytes: 9 });
    await vm.refreshLogStatus();
    finish({ path: 'C:/old/app.log', sizeBytes: 100 });
    await old;
    expect(vm.logPathHint.value).toContain('C:/latest/app.log');
    mocks.loadLogStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const late = vm.refreshLogStatus();
    scope.stop();
    finish({ path: 'C:/late/app.log', sizeBytes: 200 });
    await late;
    expect(vm.formattedLogSize.value).toBe('9 B');
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('reports a log-directory %s after leaving the page', async (outcome) => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    mocks.pickDirectoryDialog.mockResolvedValueOnce('C:/chosen');
    mocks.saveLogDirectory.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const scope = effectScope();
    const vm = scope.run(() => useSettingsViewModel())!;
    const action = vm.pickLogDirectory();
    await flushPromises();
    scope.stop();
    if (outcome === 'success') finish();
    else fail(new Error('directory denied'));
    await action;
    expect(mocks.feedback.success).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
    expect(mocks.feedback.error).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
    expect(mocks.loadLogStatus).not.toHaveBeenCalled();
    expect(vm.logPathHint.value).toContain('尚未创建');
  });

  it('keeps clear-log completion at the window while ending older status reads', async () => {
    let finish!: (value: { path: string; sizeBytes: number }) => void;
    mocks.loadLogStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const scope = effectScope();
    const vm = scope.run(() => useSettingsViewModel())!;
    const old = vm.refreshLogStatus();
    vm.confirmClearLog();
    await mocks.feedback.confirmDanger.mock.calls[0]![0].onConfirm();
    finish({ path: 'C:/old/app.log', sizeBytes: 100 });
    await old;
    expect(vm.formattedLogSize.value).toBe('0 B');
    let clear!: (value: { path: string; sizeBytes: number }) => void;
    mocks.clearLog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          clear = resolve;
        }),
    );
    vm.confirmClearLog();
    const action = mocks.feedback.confirmDanger.mock.calls[1]![0].onConfirm();
    scope.stop();
    clear({ path: 'C:/new/app.log', sizeBytes: 0 });
    await action;
    expect(mocks.feedback.success).toHaveBeenCalledTimes(2);
    expect(vm.logPathHint.value).toContain('C:/log/app.log');
  });
});
