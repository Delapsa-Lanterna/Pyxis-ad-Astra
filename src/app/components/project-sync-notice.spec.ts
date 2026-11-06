import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ProjectSyncNotice from './ProjectSyncNotice.vue';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { savedWriteFixture } from '@/test/fixtures/write-result';
const mocks = vi.hoisted(() => ({ retry: vi.fn(), retrySource: vi.fn(), error: vi.fn() }));
vi.mock('@/services/project-sync.service', () => ({ retrySourceWatch: mocks.retrySource }));
vi.mock('@/orchestrators/project-sync.orchestrator', () => ({ retryPendingWrites: mocks.retry }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
function mountNotice() {
  const sync = useProjectSyncStore();
  const event = {
    originWindowLabel: 'main',
    sessionId: 's1',
    modRoot: 'M:/mod',
    reason: 'save',
    result: savedWriteFixture(),
  } as const;
  const entry = {
    id: 'request',
    event,
    tasks: [],
    running: null,
    error: { code: 'write.delivery_failed', message: 'window', location: null },
  };
  sync.receive(entry);
  const wrapper = mount(ProjectSyncNotice, {
    global: { stubs: { 'n-button': { props: ['loading'], template: '<button :disabled="loading"><slot /></button>' } } },
  });
  return { sync, entry, wrapper };
}
describe('write synchronization notice', () => {
  it('keeps source failures through save waiting and exposes retry and actual recovery', async () => {
    const { sync, entry, wrapper } = mountNotice();
    sync.complete(entry.id);
    const status = {
      kind: 'sourceStatus' as const,
      root: 'M:/mod',
      source: 'mod' as const,
      diagnostic: {
        code: 'parse.json_syntax',
        message: 'Malformed source',
        location: { path: 'M:/mod/mod_info.json', line: 1, column: 2 },
      },
    };
    sync.setSourceStatus({ ...status, state: 'failed' });
    sync.setWaiting('M:/mod', true);
    sync.setWaiting('M:/mod', false);
    await flushPromises();
    expect(wrapper.text()).toContain('1 项外部来源等待恢复');
    expect(wrapper.text()).toContain('Malformed source');
    mocks.retrySource.mockImplementationOnce(async () => sync.setSourceStatus({ ...status, diagnostic: null, state: 'scanning' }));
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(mocks.retrySource).toHaveBeenCalledExactlyOnceWith('M:/mod');
    expect(wrapper.text()).toContain('正在重新读取 1 项来源');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    sync.setSourceStatus({ ...status, diagnostic: null, state: 'watching' });
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('shows the failed path and the remaining restoration steps', () => {
    const { sync, wrapper } = mountNotice();
    sync.setBlocked({
      kind: 'blocked',
      requestId: 'restore',
      modRoot: 'M:/mod',
      sessionId: 's1',
      diagnostic: {
        code: 'io.unexpected',
        message: '已恢复 1/3 个文件步骤\n待恢复:\nM:/mod/data/hulls/a.ship',
        location: { path: 'M:/mod/data/hulls/a.ship', line: null, column: null },
      },
    });
    return flushPromises().then(() => {
      expect(wrapper.text()).toContain('M:/mod/data/hulls/a.ship');
      expect(wrapper.text()).toContain('已恢复 1/3 个文件步骤');
      expect(wrapper.findAll('details')).toHaveLength(2);
      wrapper.unmount();
    });
  });
  it('shows the committed pending count and clears it after an explicit retry', async () => {
    const { sync, entry, wrapper } = mountNotice();
    mocks.retry.mockImplementationOnce(async () => sync.complete(entry.id));
    expect(wrapper.get('[role="status"]').text()).toContain('内容已保存，1 项同步待完成');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('keeps the failed receipt and presents one retry error', async () => {
    const { sync, entry, wrapper } = mountNotice();
    mocks.retry.mockRejectedValueOnce(new Error('still offline'));
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(sync.pending[0]?.id).toBe(entry.id);
    expect(wrapper.get('[role="status"]').text()).toContain('1 项同步待完成');
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});
