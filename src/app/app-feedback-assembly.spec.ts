import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import { createWindowFeedback } from './app-feedback-assembly';
import type { ManagedWindowContext, WriteResult } from '@/shared/types';
import { retryPendingModSyncs } from '@/orchestrators/project-sync.orchestrator';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { AppError, withCause } from '@/shared/lib/errors';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/write-result';

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  open: vi.fn(async () => {}),
  transcode: vi.fn(),
  emit: vi.fn(async () => {}),
  context: { value: null as ManagedWindowContext | null },
}));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));
vi.mock('@/windows/file-editor.window', () => ({ openFileEditorWindow: mocks.open }));
vi.mock('@/windows/window-context.window', () => ({ managedWindowContext: mocks.context }));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => 'feedback-test' }));
vi.mock('@/windows/tauri.events', () => ({ emitWindowEvent: mocks.emit, listenWindowEvent: vi.fn(async () => () => {}) }));
vi.mock('@/services/files.service', () => ({ transcodeFileToUtf8: mocks.transcode }));
let wrapper: VueWrapper | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  const update = sessionUpdateFixture('s1', 'M:/mod');
  if (update.status === 'ready') useProjectStore().registerProjectManifest(update.projection.manifest);
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
    feedback: createWindowFeedback(messages as unknown as MessageApiInjection, dialogs as unknown as DialogApiInjection, accepting),
  };
}

describe('feedback diagnostics, file authorization and actions', () => {
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
  it('captures the original session before a different project is registered', async () => {
    const { feedback, messages } = feedbackHarness();
    feedback.error({ code: 'parse.json', message: 'Invalid', location: { path: 'M:/mod/demo.skin', line: 1, column: 2 } });
    useProjectStore().removeProjectManifest('M:/mod');
    const next = sessionUpdateFixture('s2', 'M:/mod');
    if (next.status === 'ready') useProjectStore().registerProjectManifest(next.projection.manifest);
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
    expect(mocks.emit).not.toHaveBeenCalled();
    wrapper!.unmount();
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('转码为 UTF-8 失败');
  });
  it('reports written bytes separately from pending synchronization and retries the original commit', async () => {
    const { dialogs, messages } = showEncodingError();
    mocks.transcode.mockResolvedValueOnce(receipt());
    mocks.emit.mockRejectedValueOnce(new Error('broadcast failed'));
    await startTranscode(dialogs);
    expect(messages.error).toHaveBeenCalledTimes(2);
    expect(messages.success).not.toHaveBeenCalled();
    expect(useProjectSyncStore().pending).toHaveLength(1);
    wrapper!.unmount();
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('已转码为 UTF-8，项目同步失败');
    await retryPendingModSyncs('M:/mod');
    expect(useProjectSyncStore().pending).toHaveLength(0);
    expect(mocks.transcode).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledTimes(2);
  });
  it('waits for synchronization before success and completes after the source view is removed', async () => {
    const { dialogs, messages } = showEncodingError();
    let complete!: () => void;
    mocks.transcode.mockResolvedValueOnce(receipt());
    mocks.emit.mockImplementationOnce(
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
