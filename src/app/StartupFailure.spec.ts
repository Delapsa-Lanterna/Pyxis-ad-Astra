import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import StartupFailure from './StartupFailure.vue';
import { AppError } from '@/shared/lib/errors';

const actions = vi.hoisted(() => ({
  close: vi.fn(),
  minimize: vi.fn(),
  maximize: vi.fn(),
  drag: vi.fn(),
  reload: vi.fn(),
  copy: vi.fn(),
}));
vi.mock('@/windows/current.window', () => ({
  closeCurrentWindow: actions.close,
  minimizeCurrentWindow: actions.minimize,
  toggleMaximizeCurrentWindow: actions.maximize,
  startCurrentWindowDrag: actions.drag,
  reloadCurrentWindow: actions.reload,
}));
vi.mock('@/shared/runtime/clipboard.runtime', () => ({ writeClipboardText: actions.copy }));
let wrapper: VueWrapper;
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => wrapper?.unmount());
function open(reported = Promise.resolve()) {
  wrapper = mount(StartupFailure, {
    props: {
      reported,
      error: new AppError('<img src=x onerror=alert(1)>', {
        code: 'fixture.startup',
        command: 'fixture_load',
        location: { path: 'M:/sample/data.json', line: 7, column: 3 },
      }),
    },
  });
}
it('presents failure controls without settings, escapes diagnostics and copies their full identity', async () => {
  open();
  expect(wrapper.get('h1').text()).toBe('启动失败');
  expect(wrapper.findAll('img')).toHaveLength(1);
  expect(wrapper.get('details').attributes('open')).toBeUndefined();
  await wrapper.get('.startup-error-content .action-group button:nth-child(2)').trigger('click');
  await flushPromises();
  expect(JSON.parse(actions.copy.mock.calls[0]![0])).toMatchObject({
    code: 'fixture.startup',
    command: 'fixture_load',
    location: { line: 7, column: 3 },
  });
  expect(wrapper.get('[role=status]').text()).toBe('诊断信息已复制');
  await wrapper.get('.startup-error-button.primary').trigger('click');
  expect(actions.reload).toHaveBeenCalledOnce();
});
it.each(['关闭', '退出'])('waits for startup failure handoff before %s and merges repeated actions', async (label) => {
  let report!: () => void;
  open(
    new Promise<void>((resolve) => {
      report = resolve;
    }),
  );
  const button = label === '关闭' ? wrapper.get('[aria-label=关闭]') : wrapper.get('.action-group button:last-child');
  await button.trigger('click');
  await button.trigger('click');
  expect(actions.close).not.toHaveBeenCalled();
  report();
  await flushPromises();
  expect(actions.close).toHaveBeenCalledOnce();
});
it('uses native minimize, maximize and primary-pointer drag actions', async () => {
  open();
  await wrapper.get('[aria-label=最小化]').trigger('click');
  await flushPromises();
  await wrapper.get('[aria-label=最大化或还原]').trigger('click');
  await flushPromises();
  wrapper.get('header').element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, detail: 1, bubbles: true }));
  await flushPromises();
  wrapper.get('header').element.dispatchEvent(new MouseEvent('pointerdown', { button: 2, detail: 1, bubbles: true }));
  expect(actions.minimize).toHaveBeenCalledOnce();
  expect(actions.maximize).toHaveBeenCalledOnce();
  expect(actions.drag).toHaveBeenCalledOnce();
});
it('shows action failures, retains initial diagnostics and allows retry', async () => {
  open();
  actions.copy.mockRejectedValueOnce(new AppError('Clipboard unavailable', { code: 'fixture.clipboard' }));
  const copy = wrapper.get('.action-group button:nth-child(2)');
  await copy.trigger('click');
  await flushPromises();
  expect(wrapper.get('[role=status]').text()).toContain('Clipboard unavailable');
  expect(wrapper.text()).toContain('fixture.startup');
  expect(wrapper.emitted('failure')).toHaveLength(1);
  await copy.trigger('click');
  await flushPromises();
  expect(actions.copy).toHaveBeenCalledTimes(2);
  expect(wrapper.get('[role=status]').text()).toBe('诊断信息已复制');
});
