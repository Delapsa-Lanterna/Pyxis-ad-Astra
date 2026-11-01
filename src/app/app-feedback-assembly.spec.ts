import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import { createWindowFeedback } from './app-feedback-assembly';
import type { ManagedWindowContext, WriteResult } from '@/shared/types';
import { AppError, withCause } from '@/shared/lib/errors';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import { buildModOpeningFailure, modOpeningFailureNotice, scanWarningNotice, formatLoadWarnings } from '@/domain/project/load-diagnostics';
import FeedbackFileActions from '@/app/components/FeedbackFileActions.vue';
import { provideAppFeedback } from '@/app/composables/use-app-feedback';
import { h } from 'vue';
import { nButton } from '@/test/unit/ui-stubs';
import type { FileEditorRequest } from '@/windows/file-editor.window';

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  open: vi.fn<(request: FileEditorRequest) => Promise<void>>(async () => {}),
  transcode: vi.fn(),
  sync: vi.fn(),
  context: { value: null as ManagedWindowContext | null },
}));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));
vi.mock('@/windows/file-editor.window', () => ({ openFileEditorWindow: mocks.open }));
vi.mock('@/windows/window-context.window', () => ({ managedWindowContext: mocks.context }));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => 'feedback-test' }));
vi.mock('@/services/files.service', () => ({ transcodeFileToUtf8: mocks.transcode }));
let wrapper: VueWrapper | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sync.mockReset();
  mocks.sync.mockResolvedValue(undefined);
  mocks.context.value = null;
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  const update = sessionUpdateFixture('s1', 'M:/mod');
  useProjectStore().registerProjectManifest(update.projection.manifest);
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function feedbackHarness(accepting = () => true) {
  const messages = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() };
  const dialogs = { warning: vi.fn(), error: vi.fn(), create: vi.fn() };
  return {
    messages,
    dialogs,
    feedback: createWindowFeedback(
      messages as unknown as MessageApiInjection,
      dialogs as unknown as DialogApiInjection,
      () => useSettingsStore().toastDurations,
      accepting,
    ),
  };
}

describe('feedback diagnostics, file authorization and actions', () => {
  it.each(['failure', 'scan', 'loaded'] as const)('shares %s file actions between lists and toasts', async (kind) => {
    const { feedback, messages } = feedbackHarness();
    const diagnostic = { code: 'text.invalid_utf8', message: 'fixture bytes', location: { path: 'M:/mod/source.csv', line: 4, column: 2 } };
    const warning = { ...diagnostic, path: diagnostic.location.path, editTarget: { modRoot: 'M:/mod', path: diagnostic.location.path } };
    const notice =
      kind === 'failure'
        ? modOpeningFailureNotice(buildModOpeningFailure('M:/mod', diagnostic))
        : kind === 'scan'
          ? scanWarningNotice(warning)
          : formatLoadWarnings({ ...useProjectStore().getManifest('M:/mod')!, warnings: [warning] })[0]!;
    useProjectStore().removeProjectManifest('M:/mod');
    wrapper = mount(
      {
        setup() {
          provideAppFeedback(feedback);
          return () => h(FeedbackFileActions, { notice, level: 'warning' });
        },
      },
      { global: { stubs: { 'n-button': nButton } } },
    );
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['打开文件', '转码为 UTF-8']);
    await wrapper.get('button').trigger('click');
    expect(mocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: kind === 'loaded' ? 'session' : 'recovery',
        sessionId: kind === 'loaded' ? 's1' : null,
        path: diagnostic.location.path,
        line: 4,
        column: 2,
      }),
    );
    const listRequest = mocks.open.mock.lastCall;
    expect(listRequest![0]).not.toHaveProperty('message');
    expect(listRequest![0]).not.toHaveProperty('contextSeverity');
    wrapper.unmount();
    feedback.warning(notice);
    wrapper = mount({ render: messages.warning.mock.lastCall![0] });
    await wrapper.get('button').trigger('click');
    expect(mocks.open.mock.lastCall).toEqual(listRequest);
  });
  it('holds feedback recovery actions during close preparation', async () => {
    const { feedback, messages, dialogs } = feedbackHarness(() => false);
    feedback.error({ code: 'text.invalid_utf8', message: 'fixture', location: { path: 'M:/mod/notes.txt', line: null, column: null } });
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    for (const button of wrapper.findAll('button')) await button.trigger('click');
    expect(mocks.open).toHaveBeenCalledTimes(0);
    expect(dialogs.create).toHaveBeenCalledTimes(0);
  });
  it('presents and logs a recovery file-open failure once at its window provider', async () => {
    const { feedback, messages } = feedbackHarness();
    feedback.error({ code: 'parse.json', message: 'Invalid token', location: { path: 'M:/mod/demo.skin', line: 1, column: 1 } });
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    mocks.open.mockRejectedValueOnce(new Error('native window failed'));
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(messages.error).toHaveBeenCalledTimes(2);
    expect(mocks.log).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('打开文件失败');
  });
  it('renders mapped copy and structured location while logging raw diagnostics', async () => {
    const { feedback, messages } = feedbackHarness();
    const diagnostic = {
      code: 'parse.json_syntax',
      message: 'Unexpected token',
      location: { path: 'M:/mod/demo.skin', line: 3, column: 7 },
    };
    feedback.error(
      withCause('保存失败', new AppError(diagnostic.message, { command: 'save_skin_entity', cause: diagnostic }), 'save-skin'),
    );
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('JSON 语法错误');
    expect(wrapper.text()).toContain('第 3 行，第 7 列');
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: 'parse.json_syntax',
        message: 'Unexpected token',
        path: 'M:/mod/demo.skin',
        line: 3,
        fields: { action: 'save-skin', command: 'save_skin_entity', column: '7' },
      }),
    );
    await wrapper.get('button').trigger('click');
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', path: 'M:/mod/demo.skin', line: 3, column: 7 }));
  });

  it('preserves a warning diagnostic independently of its user message', () => {
    const { feedback, messages } = feedbackHarness();
    feedback.warning({
      userMessage: '读取任务失败',
      diagnostic: {
        code: 'parse.json',
        message: 'Raw scan detail',
        location: { path: 'M:/mod/descriptor.json', line: 2, column: null },
      },
    });
    wrapper = mount({ render: messages.warning.mock.lastCall![0] });
    expect(wrapper.text()).toContain('读取任务失败');
    expect(wrapper.text()).toContain('第 2 行');
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ code: 'parse.json', message: 'Raw scan detail' }));
  });

  it('offers transcoding by the wrapped stable code and owning session', () => {
    const { feedback, messages } = feedbackHarness();
    feedback.error(
      withCause('读取失败', {
        code: 'text.invalid_utf8',
        message: 'Invalid byte',
        location: { path: 'M:/mod/notes.txt', line: null, column: null },
      }),
    );
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['打开文件', '转码为 UTF-8']);
  });

  it('keeps outside-root diagnostics as display-only file locations', () => {
    const { feedback, messages } = feedbackHarness();
    feedback.error({ code: 'parse.json', message: 'Raw', location: { path: 'M:/other/demo.json', line: 1, column: 2 } });
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('M:/other/demo.json');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('routes confirmation cancel events to the pending action', () => {
    const { feedback, dialogs } = feedbackHarness();
    const cancel = vi.fn();
    feedback.confirmWarning({ title: '交接', actionText: '继续', onConfirm: vi.fn(), onCancel: cancel });
    dialogs.warning.mock.lastCall![0].onNegativeClick();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

function showEncodingError() {
  const harness = feedbackHarness();
  harness.feedback.error(
    withCause('读取失败', {
      code: 'text.invalid_utf8',
      message: 'Invalid byte',
      location: { path: 'M:/mod/notes.txt', line: null, column: null },
    }),
  );
  wrapper = mount({ render: harness.messages.error.mock.lastCall![0] });
  return harness;
}
async function startTranscode(dialogs: ReturnType<typeof feedbackHarness>['dialogs']) {
  const destroy = vi.fn();
  dialogs.create.mockReturnValue({ destroy });
  await wrapper!.findAll('button')[1]!.trigger('click');
  const choices = mount({ render: dialogs.create.mock.lastCall![0].action });
  await choices.findAll('button')[0]!.trigger('click');
  choices.unmount();
  await flushPromises();
}
function receipt(): WriteResult {
  return {
    ...savedWriteFixture(),
    changes: [
      {
        kind: 'file',
        beforePath: 'M:/mod/notes.txt',
        afterPath: 'M:/mod/notes.txt',
        beforeExists: true,
        afterExists: true,
        beforeText: 'old',
        afterText: 'new',
        beforeDataBase64: null,
        afterDataBase64: null,
        beforeFiles: [],
        afterFiles: [],
      },
    ],
  };
}
describe('window recovery completion', () => {
  it.each(['session', 'recovery'] as const)('transcodes the captured %s target and opens its latest file', async (mode) => {
    const { feedback, dialogs, messages } = feedbackHarness();
    const path = 'M:/mod/encoding.csv';
    const sessionId = mode === 'session' ? 's1' : null;
    feedback.warning({
      userMessage: 'fixture encoding',
      diagnostic: {
        code: 'text.invalid_utf8',
        message: 'fixture bytes',
        location: null,
        fileTarget: { mode, modRoot: 'M:/mod', path, sessionId },
      },
    });
    wrapper = mount({ render: messages.warning.mock.lastCall![0] });
    mocks.transcode.mockResolvedValueOnce(receipt());
    await startTranscode(dialogs);
    expect(mocks.transcode).toHaveBeenLastCalledWith(sessionId, 'M:/mod', path, 'gb18030');
    await wrapper.get('button').trigger('click');
    expect(mocks.open).toHaveBeenLastCalledWith(expect.objectContaining({ mode, path, sessionId }));
    expect(mocks.open.mock.lastCall![0]).not.toHaveProperty('message');
    expect(mocks.open.mock.lastCall![0]).not.toHaveProperty('contextSeverity');
    expect(messages.success).toHaveBeenCalledTimes(1);
  });
  it('treats a stale transcode action as information after external conversion', async () => {
    const { dialogs, messages } = showEncodingError();
    mocks.transcode.mockRejectedValueOnce({ code: 'text.transcode_not_needed', message: 'fixture UTF-8', location: null });
    await startTranscode(dialogs);
    expect(messages.error).toHaveBeenCalledTimes(1);
    expect(messages.success).toHaveBeenCalledTimes(0);
    wrapper!.unmount();
    wrapper = mount({ render: messages.info.mock.lastCall![0] });
    expect(wrapper.text()).toBe('文件已是 UTF-8，可直接打开');
  });
  it('ends an encoding selection when its window begins closing', async () => {
    let accepting = true;
    const { feedback, messages, dialogs } = feedbackHarness(() => accepting);
    feedback.error({
      code: 'text.invalid_utf8',
      message: 'fixture bytes',
      location: { path: 'M:/mod/source.csv', line: null, column: null },
    });
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    mocks.transcode.mockClear();
    dialogs.create.mockImplementationOnce(() => {
      accepting = false;
      return { destroy: vi.fn() };
    });
    await startTranscode(dialogs);
    expect(mocks.transcode).toHaveBeenCalledTimes(0);
  });
  it('captures the original session before a different project is registered', async () => {
    const { feedback, messages } = feedbackHarness();
    feedback.error({ code: 'parse.json', message: 'Invalid', location: { path: 'M:/mod/demo.skin', line: 1, column: 2 } });
    useProjectStore().removeProjectManifest('M:/mod');
    const next = sessionUpdateFixture('s2', 'M:/mod');
    useProjectStore().registerProjectManifest(next.projection.manifest);
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    await wrapper.get('button').trigger('click');
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
  });
  it.each(['manifest', 'child', 'missing-manifest-session', 'outside-child', 'no-session'] as const)(
    'uses the authorized %s session',
    async (mode) => {
      const project = useProjectStore();
      if (mode !== 'manifest') project.removeProjectManifest('M:/mod');
      if (mode === 'missing-manifest-session') vi.spyOn(project, 'getSessionId').mockReturnValue(null);
      if (mode !== 'no-session')
        mocks.context.value = {
          identity: { type: 'file', modRoot: 'M:/mod', sessionId: 'child-session', path: 'M:/mod/notes.txt' },
        } as ManagedWindowContext;
      const path = mode === 'outside-child' ? 'M:/other/notes.txt' : 'M:/mod/notes.txt';
      const { feedback, messages } = feedbackHarness();
      feedback.error({ code: 'parse.json', message: 'Invalid', location: { path, line: null, column: null } });
      wrapper = mount({ render: messages.error.mock.lastCall![0] });
      if (mode === 'outside-child' || mode === 'no-session') expect(wrapper.findAll('button')).toHaveLength(0);
      else {
        await wrapper.get('button').trigger('click');
        expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ sessionId: mode === 'manifest' ? 's1' : 'child-session' }));
      }
    },
  );
  it('cancels encoding selection without writing or final feedback', async () => {
    const { dialogs, messages } = showEncodingError();
    dialogs.create.mockReturnValue({ destroy: vi.fn() });
    await wrapper!.findAll('button')[1]!.trigger('click');
    dialogs.create.mock.lastCall![0].onClose();
    await flushPromises();
    expect(mocks.transcode).not.toHaveBeenCalled();
    expect(messages.success).not.toHaveBeenCalled();
    expect(messages.error).toHaveBeenCalledTimes(1);
  });
  it('reports a transcode failure once', async () => {
    const { dialogs, messages } = showEncodingError();
    mocks.transcode.mockRejectedValueOnce(new Error('write failed'));
    await startTranscode(dialogs);
    expect(messages.error).toHaveBeenCalledTimes(2);
    expect(messages.success).not.toHaveBeenCalled();
    wrapper!.unmount();
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('转码为 UTF-8 失败');
  });
  it('reports unfinished native completion and resumes the original save', async () => {
    const { dialogs, messages } = showEncodingError();
    mocks.transcode.mockImplementationOnce(async () => {
      await mocks.sync();
      return receipt();
    });
    mocks.sync.mockRejectedValueOnce(new Error('window update failed'));
    await startTranscode(dialogs);
    expect(messages.error).toHaveBeenCalledTimes(2);
    expect(messages.success).not.toHaveBeenCalled();
    wrapper!.unmount();
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('转码为 UTF-8 失败');
    await expect(mocks.sync()).resolves.toBeUndefined();
    expect(mocks.transcode).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });
  it('waits for synchronization before success and completes after the source view is removed', async () => {
    const { dialogs, messages } = showEncodingError();
    let complete!: () => void;
    mocks.transcode.mockImplementationOnce(async () => {
      await mocks.sync();
      return receipt();
    });
    mocks.sync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await startTranscode(dialogs);
    wrapper!.unmount();
    wrapper = null;
    expect(messages.success).not.toHaveBeenCalled();
    complete();
    await flushPromises();
    expect(messages.success).toHaveBeenCalledTimes(1);
    expect(messages.error).toHaveBeenCalledTimes(1);
    expect(mocks.transcode).toHaveBeenCalledWith('s1', 'M:/mod', 'M:/mod/notes.txt', 'gb18030');
  });
});
