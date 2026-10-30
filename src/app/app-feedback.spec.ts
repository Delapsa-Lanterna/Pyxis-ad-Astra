import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import { createAppFeedback, type FeedbackFileActions } from './app-feedback';
import { AppError, withCause, MediaReadError } from '@/shared/lib/errors';
const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));
let wrapper: VueWrapper | null = null;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});
function harness(actions: FeedbackFileActions = () => []) {
  const messages = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() };
  const dialogs = { warning: vi.fn(), error: vi.fn(), create: vi.fn() };
  return {
    messages,
    dialogs,
    feedback: createAppFeedback(messages as unknown as MessageApiInjection, dialogs as unknown as DialogApiInjection, actions),
  };
}
describe('window feedback presentation', () => {
  it('reports a shared media batch once and logs each original diagnostic', () => {
    const { feedback, messages } = harness();
    const failures = [1, 2].map((index) => ({ code: 'reference.unavailable', message: 'fixture ' + index, location: null }));
    const error = new MediaReadError(failures);
    feedback.error(error, '预读');
    feedback.error(error, '缩略图');
    expect(messages.error).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledTimes(2);
    expect(mocks.log.mock.calls.map(([entry]) => entry.message)).toEqual(['fixture 1', 'fixture 2']);
    feedback.error(new MediaReadError(failures));
    expect(messages.error).toHaveBeenCalledTimes(2);
  });
  it('preserves raw diagnostics, mapped text, location, command and action', () => {
    const { feedback, messages } = harness();
    feedback.error(
      withCause(
        '保存失败',
        new AppError('Unexpected token', {
          command: 'save_skin_entity',
          cause: { code: 'parse.json_syntax', message: 'Raw diagnostic', location: { path: 'M:/mod/demo.skin', line: 3, column: 7 } },
        }),
        'save-skin',
      ),
    );
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(wrapper.text()).toContain('JSON 语法错误');
    expect(wrapper.text()).toContain('第 3 行，第 7 列');
    expect(messages.error.mock.lastCall![1]).toEqual({ duration: 0 });
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: 'parse.json_syntax',
        message: 'Raw diagnostic',
        fields: { action: 'save-skin', command: 'save_skin_entity', column: '7' },
      }),
    );
  });
  it('captures supplied file actions once and renders their labels and callbacks', async () => {
    const run = vi.fn();
    const actions = vi.fn(() => [{ label: '定位', type: 'warning' as const, run }]);
    const { feedback, messages } = harness(actions);
    feedback.error({ code: 'parse.json', message: 'Invalid', location: { path: 'M:/mod/demo.json', line: 1, column: null } });
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    await wrapper.get('button').trigger('click');
    expect(run).toHaveBeenCalledOnce();
    wrapper.unmount();
    wrapper = mount({ render: messages.error.mock.lastCall![0] });
    expect(actions).toHaveBeenCalledOnce();
  });
  it('keeps warning copy separate from diagnostics and preserves provider durations for ordinary messages', () => {
    const { feedback, messages } = harness();
    feedback.warning({ userMessage: '读取任务失败', diagnostic: { code: 'parse.json', message: 'Raw detail', location: null } });
    wrapper = mount({ render: messages.warning.mock.lastCall![0] });
    expect(wrapper.text()).toContain('读取任务失败');
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ message: 'Raw detail' }));
    expect(messages.warning.mock.lastCall).toHaveLength(1);
    mocks.log.mockClear();
    feedback.success('已完成');
    feedback.info('信息');
    expect(mocks.log).not.toHaveBeenCalled();
    expect(messages.success.mock.lastCall).toHaveLength(1);
    expect(messages.info.mock.lastCall).toHaveLength(1);
  });
  it.each(['confirmWarning', 'confirmDanger'] as const)('forwards confirmation and all cancellation routes through %s', (kind) => {
    const { feedback, dialogs } = harness();
    const onConfirm = vi.fn(),
      onCancel = vi.fn();
    feedback[kind]({ title: '交接', actionText: '继续', onConfirm, onCancel });
    const options = (kind === 'confirmWarning' ? dialogs.warning : dialogs.error).mock.lastCall![0];
    options.onPositiveClick();
    expect(onConfirm).toHaveBeenCalledOnce();
    for (const event of ['onNegativeClick', 'onClose', 'onMaskClick']) options[event]();
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});
