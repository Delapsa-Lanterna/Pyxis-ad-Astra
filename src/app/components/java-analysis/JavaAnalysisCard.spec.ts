import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { AppFeedback, JavaManagementSnapshot } from '@/shared/types';
import type { manageJavaAnalysis, subscribeJavaAnalysis } from '@/services/java-analysis.service';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { editorUiStubs, nButton } from '@/test/unit/ui-stubs';
import JavaAnalysisCard from './JavaAnalysisCard.vue';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn<typeof subscribeJavaAnalysis>(),
  manage: vi.fn<typeof manageJavaAnalysis>(),
  unsubscribe: vi.fn(async () => {}),
  cancel: vi.fn<(operationKey: string) => Promise<JavaManagementSnapshot>>(),
  context: vi.fn(async () => 'G:/sample/jre/bin/java.exe'),
  open: vi.fn(async () => {}),
  pick: vi.fn<() => Promise<string | null>>(),
  feedback: { success: vi.fn(), info: vi.fn(), error: vi.fn(), confirmDanger: vi.fn<AppFeedback['confirmDanger']>() },
}));
vi.mock('@/services/java-analysis.service', () => ({
  subscribeJavaAnalysis: mocks.subscribe,
  unsubscribeJavaAnalysis: mocks.unsubscribe,
  manageJavaAnalysis: mocks.manage,
  cancelJavaAnalysis: mocks.cancel,
  javaAnalysisContext: mocks.context,
  openJavaAnalysisDirectory: mocks.open,
}));
vi.mock('@/shared/runtime/dialog.runtime', () => ({ pickFileDialog: mocks.pick }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
enableAutoUnmount(afterEach);

function snapshot(patch: Partial<JavaManagementSnapshot> = {}): JavaManagementSnapshot {
  return {
    revision: 1,
    operationKey: null,
    queued: 0,
    action: null,
    active: false,
    phase: 'idle',
    installation: 'missing',
    jdtVersion: '3.47.0',
    downloadBytes: 16423216,
    installedBytes: 0,
    installationPath: 'G:/sample/config/java-analysis/dependencies/fixed',
    logPath: 'G:/sample/config/java-analysis/logs',
    stagedBytes: 0,
    instances: 0,
    projects: 0,
    progress: null,
    environment: null,
    error: null,
    ...patch,
  };
}
function submission(key: string, value: JavaManagementSnapshot): JavaManagementSnapshot {
  return { ...value, operationKey: value.operationKey ?? key };
}
let receive: (value: JavaManagementSnapshot) => void;
function card() {
  return mount(JavaAnalysisCard, {
    props: { sessionId: null, gameRoot: 'G:/sample' },
    global: { stubs: { ...editorUiStubs, 'n-progress': true } },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  mocks.subscribe.mockImplementation(async (listener) => {
    receive = listener;
    listener(snapshot());
    return '00000000-0000-0000-0000-000000000001';
  });
  mocks.pick.mockResolvedValue(null);
});

describe('Java component management card', () => {
  it('shows installed version and measured files separately from download inventory', async () => {
    const wrapper = card();
    await flushPromises();
    expect(wrapper.text()).toContain('目标版本 JDT 3.47.0 · 下载大小 15.66 MiB');
    receive(snapshot({ revision: 2, installation: 'installed', installedBytes: 16777216 }));
    await flushPromises();
    expect(wrapper.text()).toContain('已安装版本 JDT 3.47.0');
    expect(wrapper.text()).toContain('安装占用');
    expect(wrapper.text()).toContain('16.00 MiB');
    expect(wrapper.text()).not.toContain('下载大小');
    receive(snapshot({ revision: 3, installation: 'missing' }));
    await flushPromises();
    expect(wrapper.text()).not.toContain('安装占用');
    expect(wrapper.text()).toContain('下载大小 15.66 MiB');
  });
  it('keeps dangerous actions red and blocks dependency changes while analysis is active', async () => {
    const wrapper = card();
    await flushPromises();
    receive(snapshot({ revision: 2, installation: 'installed', instances: 1, projects: 2 }));
    await flushPromises();
    const buttons = wrapper.findAllComponents(nButton);
    const button = (name: string) => buttons.find((entry) => entry.text() === name)!;
    expect(button('检查并修复').props('disabled')).toBe(true);
    expect(button('移除组件').props()).toMatchObject({ type: 'error', disabled: true });
    expect(button('停止全部分析').props()).toMatchObject({ type: 'error', disabled: false });
    await button('停止全部分析').trigger('click');
    expect(mocks.feedback.confirmDanger).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('2 个') }));
    expect(wrapper.text()).toContain('1 个 JVM · 2 个项目');
  });
  it('retains backend work across unmount and accepts the current snapshot on reentry', async () => {
    mocks.manage.mockResolvedValue(
      submission('download-one', snapshot({ revision: 2, active: true, action: { kind: 'download' }, phase: 'downloading' })),
    );
    const wrapper = card();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载安装')!
      .trigger('click');
    await flushPromises();
    expect(mocks.manage).toHaveBeenCalledWith({ kind: 'download' }, expect.any(String));
    const cancel = wrapper.findAllComponents(nButton).find((button) => button.text() === '取消操作')!;
    expect(cancel.props('type')).toBe('default');
    wrapper.unmount();
    await flushPromises();
    expect(mocks.unsubscribe).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
    expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.subscribe.mockImplementation(async (listener) => {
      receive = listener;
      listener(snapshot({ operationKey: 'download-one', revision: 4, installation: 'installed', phase: 'succeeded' }));
      return '00000000-0000-0000-0000-000000000002';
    });
    const reopened = card();
    await flushPromises();
    expect(reopened.text()).toContain('已安装');
    expect(mocks.manage).toHaveBeenCalledTimes(1);
  });
  it('shows cancellation receipt once and keeps verified bytes visible', async () => {
    let complete!: (value: JavaManagementSnapshot) => void;
    mocks.manage.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const wrapper = card();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载安装')!
      .trigger('click');
    await flushPromises();
    const done = snapshot({ revision: 3, operationKey: 'download-two', phase: 'cancelled', stagedBytes: 1024 });
    receive(done);
    receive(done);
    complete(done);
    await flushPromises();
    expect(mocks.feedback.info).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('已校验文件将在重试时复用');
  });
  it('binds cancel to the displayed task identity', async () => {
    const wrapper = card();
    await flushPromises();
    mocks.cancel.mockImplementation(async (operationKey) => snapshot({ revision: 3, operationKey, phase: 'cancelling' }));
    receive(snapshot({ revision: 2, operationKey: 'download-seven', active: true, action: { kind: 'download' }, phase: 'downloading' }));
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消操作')!
      .trigger('click');
    expect(mocks.cancel).toHaveBeenCalledWith('download-seven');
  });
  it('accepts completion delivered before the command reply and reports each failure once', async () => {
    mocks.manage.mockImplementation(async () => {
      receive(snapshot({ revision: 3, operationKey: 'download-three', phase: 'failed', error: 'sample transport failure' }));
      return submission(
        'download-three',
        snapshot({ revision: 3, operationKey: 'download-three', phase: 'failed', error: 'sample transport failure' }),
      );
    });
    const wrapper = card();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载安装')!
      .trigger('click');
    await flushPromises();
    receive(snapshot({ revision: 3, operationKey: 'download-three', phase: 'failed', error: 'sample transport failure' }));
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('sample transport failure');
  });
  it('verifies a selected Java before saving and restores the automatic source explicitly', async () => {
    mocks.pick.mockResolvedValue('H:/runtime/bin/java.exe');
    mocks.manage.mockResolvedValue(
      submission(
        'probe-one',
        snapshot({
          revision: 2,
          operationKey: 'probe-one',
          action: { kind: 'probe', javaPath: 'H:/runtime/bin/java.exe' },
          phase: 'succeeded',
          environment: { path: 'H:/runtime/bin/java.exe', version: '17', milliseconds: 12, released: true, logPath: null },
        }),
      ),
    );
    const wrapper = card();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '选择文件')!
      .trigger('click');
    await flushPromises();
    expect(useSettingsStore().settingsSnapshot().javaExecutable).toBe('H:/runtime/bin/java.exe');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '清除')!
      .trigger('click');
    expect(useSettingsStore().javaExecutable).toBeNull();
    mocks.pick.mockResolvedValue(null);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '选择文件')!
      .trigger('click');
    await flushPromises();
    expect(mocks.manage).toHaveBeenCalledTimes(1);
  });
});
