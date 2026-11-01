import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h, ref } from 'vue';
import type { WindowCloseIntent, CloseResult } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
const api = vi.hoisted(() => ({
  listener: vi.fn(),
  native: vi.fn(),
  reply: vi.fn(),
  ready: vi.fn(),
  choose: vi.fn(),
  error: vi.fn(),
  prepare: vi.fn(),
  resume: vi.fn(),
  close: vi.fn(),
  flush: vi.fn(),
  flushPerformance: vi.fn(),
  label: 'close-fixture',
  readResume: vi.fn(),
  acceptReleased: vi.fn(),
}));
vi.mock('@/app/composables/use-query-read-owner', async (original) => {
  const actual = await original<typeof UseQueryReadOwnerModule>();
  return {
    ...actual,
    pauseQueryReads: () => {
      const resume = actual.pauseQueryReads();
      api.readResume.mockImplementation(resume);
      return api.readResume;
    },
  };
});
vi.mock('@/windows/current.window', () => ({
  currentWindowLabel: () => api.label,
  listenCurrentWindowCloseRequest: async (handler: (...args: unknown[]) => unknown) => {
    api.close.mockImplementation(handler);
    return vi.fn();
  },
}));
vi.mock('@/shared/runtime/event.runtime', () => ({
  listenAppEvent: async (_event: string, handler: (intent: WindowCloseIntent) => unknown) => {
    api.listener.mockImplementation(handler);
    return vi.fn();
  },
}));
vi.mock('@/services/window.service', () => ({
  updateNativeWindowStatus: vi.fn(async () => {}),
}));
vi.mock('@/windows/window-context.window', () => ({ settleWindowRequests: async () => {} }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: api.choose, error: api.error }) }));
vi.mock('./use-window-close-state', () => ({ useWindowCloseState: () => ref(false), useWindowCloseRequest: () => api.native }));
import { useAppCloseParticipant, provideAppCloseActions } from './use-app-close-participant';
import { useQueryReadOwner } from './use-query-read-owner';
import type * as UseQueryReadOwnerModule from '@/app/composables/use-query-read-owner';

const intent = (phase: WindowCloseIntent['phase']): WindowCloseIntent => ({
  operationId: 7,
  phase,
  scope: { kind: 'window' },
  onlyIfClean: false,
  releasedSessions: [],
});
async function setup(dirty = ref(false), flushSettings = async () => {}) {
  let guard!: ReturnType<typeof useAppCloseParticipant>;
  const Content = {
    setup() {
      guard = useAppCloseParticipant({ dirty, title: 'fixture', content: 'fixture' });
      return () => null;
    },
  };
  const wrapper = mount({
    setup() {
      api.flush.mockImplementation(flushSettings);
      provideAppCloseActions({
        replyClose: api.reply,
        readyClose: api.ready,
        acceptReleasedSessions: api.acceptReleased,
        flushPerformance: api.flushPerformance,
        flushSettings: api.flush,
        prepareDisplay: () => {
          api.prepare();
          return api.resume;
        },
      });
      return () => h(Content);
    },
  });
  await guard.install();
  return { guard, wrapper };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  api.label = 'close-fixture';
  api.flushPerformance.mockResolvedValue(undefined);
  api.choose.mockResolvedValue('discard');
  api.reply.mockResolvedValue(undefined);
  api.resume.mockResolvedValue(undefined);
});
describe('window close preparation', () => {
  it('delivers queued identity reads after a cancelled close resumes queries', async () => {
    const { guard, wrapper } = await setup();
    const ready = vi.fn();
    const consumer = mount({
      setup() {
        const owner = useQueryReadOwner();
        api.resume.mockImplementation(async () => {
          await owner.consume('identity', { id: 'renamed' }, () => 'renamed', { ready });
        });
        return () => null;
      },
    });
    for (const phase of ['hold', 'prepare', 'confirm', 'resume'] as const) await api.listener(intent(phase));
    expect(ready).toHaveBeenCalledExactlyOnceWith('renamed');
    consumer.unmount();
    guard.dispose();
    wrapper.unmount();
  });
  it('hands released sessions to display cleanup before resuming reads', async () => {
    const { guard, wrapper } = await setup();
    for (const phase of ['hold', 'prepare'] as const) await api.listener(intent(phase));
    await api.listener({ ...intent('resume'), releasedSessions: ['released-fixture'] });
    expect(api.acceptReleased).toHaveBeenCalledExactlyOnceWith(['released-fixture']);
    expect(api.acceptReleased.mock.invocationCallOrder[0]).toBeLessThan(api.readResume.mock.invocationCallOrder[0]!);
    expect(api.readResume.mock.invocationCallOrder[0]).toBeLessThan(api.resume.mock.invocationCallOrder[0]!);
    guard.dispose();
    wrapper.unmount();
  });
  it('waits for executing actions and saves before capturing the latest dirty content', async () => {
    const dirty = ref(false),
      saving = ref(true);
    let finish!: () => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = () => {
        saving.value = false;
        dirty.value = true;
        resolve(true);
      };
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('a'), modRoot: ref('M:/fixture'), saving, waitForSave: () => pending });
    const { guard, wrapper } = await setup(dirty);
    await api.listener(intent('hold'));
    const settling = api.listener(intent('settle'));
    await flushPromises();
    expect(api.choose).toHaveBeenCalledTimes(0);
    finish();
    await settling;
    await api.listener(intent('prepare'));
    await api.listener(intent('confirm'));
    expect(api.choose).toHaveBeenCalledOnce();
    expect(api.reply).toHaveBeenLastCalledWith(7, 'confirm', true, null);
    await api.listener(intent('resume'));
    expect(api.resume).toHaveBeenCalledOnce();
    guard.dispose();
    wrapper.unmount();
  });
  it.each(['cancel', 'failure'])('delivers %s to the native operation and resumes surviving owners', async (outcome) => {
    const { guard, wrapper } = await setup(ref(true));
    if (outcome === 'cancel') api.choose.mockResolvedValue(null);
    else api.choose.mockRejectedValue(new Error('fixture failure'));
    for (const phase of ['hold', 'settle', 'prepare', 'confirm'] as const) await api.listener(intent(phase));
    expect(api.reply).toHaveBeenLastCalledWith(
      7,
      'confirm',
      false,
      outcome === 'cancel' ? null : expect.objectContaining({ message: 'fixture failure' }),
    );
    await api.listener(intent('resume'));
    expect(useSaveCommandStore().closePrepared).toBe(false);
    expect(api.resume).toHaveBeenCalledOnce();
    guard.dispose();
    wrapper.unmount();
  });
  it('holds a close request until the native result and coalesces repeated requests', async () => {
    let finish!: (result: CloseResult) => void;
    api.native.mockImplementation(
      () =>
        new Promise<CloseResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { guard, wrapper } = await setup();
    const pending = guard.requestClose();
    expect(guard.requestClose()).toBe(pending);
    expect(api.native).toHaveBeenCalledExactlyOnceWith({ kind: 'window' });
    finish({ status: 'closed', destroyedWindows: ['managed-1'], releasedSessions: [], diagnostic: null });
    expect(await pending).toBe(true);
    guard.dispose();
    wrapper.unmount();
  });
  it('reports a settings failure as a structured flush result', async () => {
    api.label = 'main';
    const { guard, wrapper } = await setup(ref(false), async () => {
      throw new Error('disk failure');
    });
    await api.listener(intent('hold'));
    await api.listener({ ...intent('flush'), scope: { kind: 'application' } });
    expect(api.reply).toHaveBeenLastCalledWith(7, 'flush', false, expect.objectContaining({ message: 'disk failure' }));
    guard.dispose();
    wrapper.unmount();
  });
  it('delivers a child window performance tail before acknowledging flush', async () => {
    const { guard, wrapper } = await setup();
    await api.listener(intent('hold'));
    await api.listener(intent('flush'));
    expect(api.flushPerformance).toHaveBeenCalledOnce();
    expect(api.flush).not.toHaveBeenCalled();
    expect(api.flushPerformance.mock.invocationCallOrder[0]!).toBeLessThan(api.reply.mock.invocationCallOrder.at(-1)!);
    expect(api.reply).toHaveBeenLastCalledWith(7, 'flush', true, null);
    guard.dispose();
    wrapper.unmount();
  });
});
