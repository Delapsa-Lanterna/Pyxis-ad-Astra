import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { editorUiStubs, nInputNumber } from '@/test/ui-stubs';
import SettingsPage from './SettingsPage.vue';

vi.mock('@/app/composables/settings/use-settings-view-model', () => ({
  useSettingsViewModel: () => ({
    formattedLogSize: ref('0 B'),
    logPathHint: ref('Log'),
    pickLogDirectory: vi.fn(),
    pickStarsectorRoot: vi.fn(),
    refreshLogStatus: vi.fn(),
    openConfigFolderAction: vi.fn(),
    openLogFileAction: vi.fn(),
    restoreDefaultLogDirectory: vi.fn(),
    confirmClearConfig: vi.fn(),
    confirmClearLog: vi.fn(),
  }),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#2563eb',
    fileHistoryLimit: 20,
    editHistoryLimit: 250,
    logRotationSizeMiB: 5,
    logBackupCount: 1,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
});

describe('settings limit controls', () => {
  it('places history and log settings in their sections with units and scope hints', async () => {
    const wrapper = mount(SettingsPage, {
      global: {
        stubs: { ...editorUiStubs, ColorPicker: true, 'n-radio-group': { template: '<div><slot /></div>' }, 'n-radio-button': true },
      },
    });
    const sections = wrapper.findAll('section');
    const history = sections.find((section) => section.get('h3').text() === '全局限制')!;
    const config = sections.find((section) => section.get('h3').text() === '配置文件')!;
    expect(history.text()).toContain('文件保存历史步数');
    expect(history.text()).toContain('编辑撤销步数');
    expect(history.text()).toContain('独立');
    expect(history.text()).toContain('立即裁剪');
    expect(config.text().indexOf('日志轮转大小（MiB）')).toBeGreaterThan(config.text().indexOf('日志级别'));
    expect(config.text()).toContain('日志备份份数');
    expect(config.text()).toContain('下次轮转');
    const controls = wrapper.findAllComponents(nInputNumber);
    expect(controls.map((control) => [control.props('value'), control.props('min'), control.props('max')])).toEqual([
      [20, 1, 1000],
      [250, 1, 1000],
      [5, 1, 1024],
      [1, 1, 20],
    ]);
    for (const [index, value] of [40, 400, 12, 3].entries()) await controls[index]!.get('input').setValue(String(value));
    expect(useSettingsStore().settingsSnapshot()).toMatchObject({
      fileHistoryLimit: 40,
      editHistoryLimit: 400,
      logRotationSizeMiB: 12,
      logBackupCount: 3,
    });
    await controls[0]!.get('input').setValue('');
    expect(useSettingsStore().fileHistoryLimit).toBe(40);
    wrapper.unmount();
  });
});
