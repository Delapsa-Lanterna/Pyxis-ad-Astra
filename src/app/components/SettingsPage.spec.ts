import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { editorUiStubs, nInputNumber } from '@/test/unit/ui-stubs';
import SettingsPage from './SettingsPage.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';

const logUi = vi.hoisted(() => ({ refresh: vi.fn(), reset: vi.fn(), pickFont: vi.fn() }));
vi.mock('@/app/composables/settings/use-settings-view-model', () => ({
  useSettingsViewModel: (onReset?: () => void) => ({
    logStatus: ref({ recording: 'stopped', level: 'warning', pending: 0, dropped: 7, lastError: 'fixture write error' }),
    applicationLogError: ref(''),
    monitorStatus: ref({
      enabled: false,
      records: 0,
      overwritten: 0,
      startedAt: 0,
      path: '',
      traceAvailable: true,
      traceState: 'idle',
      traceSeconds: 15,
      traceStartedAt: 0,
      traceError: '',
    }),
    monitorAction: vi.fn(),
    traceSeconds: ref(15),
    performanceMonitorError: ref(''),
    formattedLogSize: ref('0 B'),
    fontOptions: ref([
      { label: '默认字体组合', value: '' },
      { label: 'Microsoft YaHei', value: 'Microsoft YaHei' },
    ]),
    fontsLoading: ref(false),
    loadSystemFonts: vi.fn(),
    logPathHint: ref('Log'),
    pickLogDirectory: vi.fn(),
    pickStarsectorRoot: vi.fn(),
    changeStarsectorRoot: vi.fn(),
    pickImmersiveFontDirectory: logUi.pickFont,
    refreshLogStatus: logUi.refresh,
    openConfigFolderAction: vi.fn(),
    confirmResetSettings: () => {
      logUi.reset();
      onReset?.();
    },
    restoreDefaultLogDirectory: vi.fn(),
    confirmClearLog: vi.fn(),
  }),
}));

beforeEach(() => {
  logUi.refresh.mockClear();
  logUi.reset.mockClear();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});

describe('settings limit controls', () => {
  it('resets local invalid color input when the saved default color is unchanged', async () => {
    const wrapper = mount(SettingsPage, { global: { stubs: { ...editorUiStubs, ColorPicker: true } } });
    const color = wrapper.getComponent(ColorPicker);
    color.vm.$emit('update:modelValue', 'invalid');
    await wrapper.vm.$nextTick();
    expect(color.props('modelValue')).toBe('invalid');
    expect(wrapper.find('.color-picker-palette .field-description').exists()).toBe(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重置为默认配置')!
      .trigger('click');
    expect(color.props('modelValue')).toBe(useSettingsStore().customAccent);
    expect(wrapper.find('.color-picker-palette .field-description').exists()).toBe(false);
    wrapper.unmount();
  });
  it('offers all four minimum levels and exposes the stopped-run status', async () => {
    const wrapper = mount(SettingsPage, {
      global: { stubs: { ...editorUiStubs, ColorPicker: true } },
    });
    const config = wrapper.findAll('section').find((section) => section.get('h3').text() === '配置文件')!;
    const select = config.get('select');
    await config
      .findAll('button')
      .find((button) => button.text() === '重置为默认配置')!
      .trigger('click');
    expect(logUi.reset).toHaveBeenCalledOnce();
    expect(config.text()).toContain('本次运行已停止记录');
    expect(config.text()).toContain('WARNING');
    expect(config.text()).toContain('未写入 7 条');
    expect(config.text()).toContain('fixture write error');
    expect(logUi.refresh).toHaveBeenCalledOnce();
    await config
      .findAll('button')
      .find((button) => button.text() === '刷新日志状态')!
      .trigger('click');
    expect(logUi.refresh).toHaveBeenCalledTimes(2);
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      '详细（DEBUG）',
      '常规（INFO）',
      '警告（WARNING）',
      '错误（ERROR）',
    ]);
    for (const level of ['debug', 'warning', 'error', 'info'] as const) {
      await select.setValue(JSON.stringify(level));
      expect(useSettingsStore().logLevel).toBe(level);
    }
    wrapper.unmount();
  });
  it('places default-off monitoring last and keeps the runtime state until restart', async () => {
    const wrapper = mount(SettingsPage, {
      global: {
        stubs: { ...editorUiStubs, ColorPicker: true, 'n-radio-group': { template: '<div><slot /></div>' }, 'n-radio-button': true },
      },
    });
    const sections = wrapper.findAll('section');
    const monitor = sections.at(-1)!;
    expect(monitor.get('h3').text()).toBe('性能调试');
    expect(sections.at(-2)!.text()).toContain('日志级别');
    const traceDuration = monitor.findComponent(nInputNumber);
    expect(traceDuration.props()).toMatchObject({ min: 1, max: 60, step: 1, value: 15 });
    expect(monitor.findAll('.action-group button').map((button) => button.text())).toEqual([
      '刷新状态',
      '重新采集',
      '导出报告',
      '开始录制',
      '结束录制',
    ]);
    expect(useSettingsStore().performanceMonitorEnabled).toBe(false);
    expect(monitor.text()).toContain('修改后重启应用生效');
    expect(monitor.text()).toContain('已关闭');
    await monitor.get('.n-switch-stub').trigger('click');
    expect(useSettingsStore().performanceMonitorEnabled).toBe(true);
    expect(monitor.text()).toContain('已关闭');
    expect(monitor.text()).toContain('重启后应用新设置');
    expect(
      monitor
        .findAll('.action-group button')
        .slice(1)
        .every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true);
    wrapper.unmount();
  });
  it('places general and immersive fonts below appearance and applies both controls', async () => {
    const wrapper = mount(SettingsPage, {
      global: {
        stubs: { ...editorUiStubs, ColorPicker: true, 'n-radio-group': { template: '<div><slot /></div>' }, 'n-radio-button': true },
      },
    });
    const sections = wrapper.findAll('section');
    expect(sections.map((section) => section.get('h3').text()).slice(1, 6)).toEqual(['外观', '字体', '编辑', 'JSON 保存', '缓存限制']);
    const editing = sections[3]!;
    expect(editing.findAll('.field-label').map((label) => label.text())).toEqual(['引用式编辑', '展开字段解析', '允许编辑原版']);
    expect(useSettingsStore().expandFieldDescriptions).toBe(false);
    await editing.get('.n-switch-stub').trigger('click');
    expect(useSettingsStore().editMode).toBe('plain');
    await editing.get('.n-switch-stub').trigger('click');
    expect(useSettingsStore().editMode).toBe('smart');
    await editing.findAll('.n-switch-stub')[1]!.trigger('click');
    expect(useSettingsStore().expandFieldDescriptions).toBe(true);
    const core = editing.findAll('.schema-field').at(-1)!;
    expect(core.get('.field-description').text()).toBe('允许写入 Starsector 原版内容。');
    expect(core.get('.field-warning').text()).toBe('注意：修改原版文件可能影响游戏运行，操作前请备份并谨慎修改。');
    await core.get('.n-switch-stub').trigger('click');
    expect(useSettingsStore().allowCoreEditing).toBe(true);
    useSettingsStore().setStarsectorRoot('D:/fixture');
    await wrapper.vm.$nextTick();
    expect(sections[0]!.get('.field-description').text()).toBe('已设置: D:/fixture');
    const immersive = sections[2]!;
    expect(immersive.findAll('.schema-field > .field-label').map((label) => label.text())).toEqual([
      '通用字体',
      '沉浸式编辑器字体',
      '沉浸式字体路径',
    ]);
    expect(useSettingsStore().generalFont).toBeNull();
    await immersive.get('select').setValue('"Microsoft YaHei"');
    expect(useSettingsStore().generalFont).toBe('Microsoft YaHei');
    await immersive.get('select').setValue('""');
    expect(useSettingsStore().generalFont).toBeNull();
    expect(immersive.text()).toContain('再尝试游戏原版字体');
    expect(useSettingsStore().immersiveGameFont).toBe(true);
    await immersive.get('button').trigger('click');
    expect(useSettingsStore().immersiveGameFont).toBe(false);
    const directory = immersive.findAll('.schema-field').at(-1)!;
    await directory.get('button').trigger('click');
    expect(logUi.pickFont).toHaveBeenCalledOnce();
    useSettingsStore().setImmersiveFontDirectory('F:/fonts');
    await wrapper.vm.$nextTick();
    expect((directory.get('input').element as HTMLInputElement).value).toBe('F:/fonts');
    await directory.findAll('button')[1]!.trigger('click');
    expect(useSettingsStore().immersiveFontDirectory).toBeNull();
    wrapper.unmount();
  });
  it('places history and log settings in their sections with units and scope hints', async () => {
    const wrapper = mount(SettingsPage, {
      global: {
        stubs: { ...editorUiStubs, ColorPicker: true, 'n-radio-group': { template: '<div><slot /></div>' }, 'n-radio-button': true },
      },
    });
    const sections = wrapper.findAll('section');
    const history = sections.find((section) => section.get('h3').text() === '缓存限制')!;
    const config = sections.find((section) => section.get('h3').text() === '配置文件')!;
    expect(history.text()).toContain('文件保存历史步数');
    expect(history.text()).toContain('编辑撤销步数');
    expect(history.text()).toContain('独立');
    expect(history.text()).toContain('立即裁剪');
    expect(config.text().indexOf('日志轮转大小（MiB）')).toBeGreaterThan(config.text().indexOf('日志级别'));
    expect(config.text()).toContain('日志备份份数');
    expect(config.text()).toContain('下次轮转');
    const cached = wrapper.findAllComponents(nInputNumber).slice(2, 19);
    expect(cached.map((control) => control.props('value'))).toEqual([
      2048, 64, 1024, 96, 2048, 32, 512, 64, 16, 128, 80, 240, 400, 128, 128, 128, 512,
    ]);
    for (const control of cached) {
      await control.get('input').setValue('0');
      expect(control.props('value')).toBe(0);
      expect(control.props('min')).toBe(0);
    }
    const controls = [...history.findAllComponents(nInputNumber).slice(0, 2), ...config.findAllComponents(nInputNumber)];
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
