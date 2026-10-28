import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJsonListSelection } from './use-json-list-selection';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import type { AppFeedback } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  release: vi.fn(async () => {}),
  contentError: vi.fn(),
  content: null as null | { retryContent: () => Promise<unknown> },
  feedback: { success: vi.fn(), info: vi.fn(), error: vi.fn(), confirmWarning: vi.fn<AppFeedback['confirmWarning']>() },
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: mocks.release }));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  beginSavedWrite: <T>(
    write: () => Promise<T>,
    accept: (value: Exclude<T, void | null>) => import('@/stores/project-sync.store').SaveTask[],
  ) => {
    const fixture = import('@/test/unit/project-changes');
    const written = write();
    const content = fixture.then(({ beginSavedWrite }) => {
      const pending = beginSavedWrite(() => written, accept, mocks.complete);
      mocks.content = pending;
      return pending.content;
    });
    void content.catch(mocks.contentError);
    return { id: 'selection-save', result: written };
  },
}));
let wrapper: VueWrapper;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.complete.mockResolvedValue(undefined);
  mocks.content = null;
});
afterEach(() => wrapper?.unmount());

function harness(discard?: (id: string) => Promise<boolean>) {
  const modRoot = ref<string | null>('M:/mod');
  const sessionId = ref<string | null>('s1');
  const dirty = ref(false);
  let selection!: ReturnType<typeof useJsonListSelection>;
  wrapper = mount({
    setup() {
      selection = useJsonListSelection({ selectedId: ref(null), modRoot, sessionId, label: '战役', discard });
      return () => null;
    },
  });
  useJsonEditorStore().activate({
    target: ref({ kind: 'mission', id: 'a', entity: null, sessionId: 's1', modRoot: 'M:/mod' }),
    saving: ref(false),
    targetKey: ref('mission:a'),
    dirty,
    inputs: createFieldInputs(ref('mission:a')),
    canUndo: ref(false),
    canRedo: ref(false),
    undo: async () => null,
    redo: async () => null,
    save: async () => ({ status: 'noop' }),
    waitForSave: async () => true,
  });
  selection.reconcile(['a', 'b']);
  return { selection, modRoot, sessionId, dirty };
}

function mutation(
  selection: ReturnType<typeof useJsonListSelection>,
  options: { changesTarget?: boolean; accept?: () => Promise<boolean> } = {},
) {
  const write = vi.fn(async () => savedWriteFixture());
  const accept =
    options.accept ??
    vi.fn(async () => {
      selection.selectedId.value = 'b';
      return true;
    });
  return {
    write,
    accept,
    run: () =>
      selection.mutate({
        sessionId: 's1',
        modRoot: 'M:/mod',
        changesTarget: options.changesTarget ?? true,
        label: 'Created mission',
        write,
        accept,
      }),
  };
}

describe('config list selection and action boundaries', () => {
  it('selects the domain-ordered first item and retains a surviving selection', () => {
    const { selection } = harness();
    expect(selection.selectedId.value).toBe('a');
    selection.reconcile(['b', 'a']);
    expect(selection.selectedId.value).toBe('a');
    selection.reconcile(['b']);
    expect(selection.selectedId.value).toBe('b');
    selection.reconcile([]);
    expect(selection.selectedId.value).toBeNull();
  });

  it('retains a deleted dirty target until explicit discard is confirmed', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    selection.reconcile(['b']);
    expect(selection.selectedId.value).toBe('a');
    expect(selection.deletedTarget.value).toBe(true);
    const pending = selection.discardDeleted();
    await flushPromises();
    mocks.feedback.confirmWarning.mock.lastCall![0].onCancel!();
    await pending;
    expect(selection.selectedId.value).toBe('a');
    const confirmed = selection.discardDeleted();
    await flushPromises();
    mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    await confirmed;
    expect(selection.selectedId.value).toBe('b');
    expect(selection.deletedTarget.value).toBe(false);
  });

  it('reports preparation failures while discarding a deleted target', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    selection.reconcile(['b']);
    const error = new Error('sync failed');
    vi.spyOn(useJsonEditorStore().active!.inputs, 'commit').mockImplementationOnce(() => {
      throw error;
    });
    await selection.discardDeleted();
    expect(mocks.feedback.error).toHaveBeenCalledExactlyOnceWith(error, '放弃战役编辑失败');
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('cleans a missing target without opening a second confirmation', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    selection.reconcile(['b']);
    expect(await selection.discardMissing('a')).toBe(true);
    expect(selection.selectedId.value).toBe('b');
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
    expect(mocks.feedback.success).toHaveBeenCalledExactlyOnceWith('战役 "a" 已移除，源文件已不存在');
  });

  it.each(['discard', 'delete'] as const)('reports a failed save wait during %s', async (action) => {
    const { selection } = harness();
    useSaveCommandStore().registerSaveSession({
      modRoot: ref('M:/mod'),
      targetKey: ref('saving'),
      saving: ref(true),
      waitForSave: async () => false,
    });
    await (action === 'discard' ? selection.discardDeleted() : selection.discardMissing('a'));
    expect(mocks.feedback.info).toHaveBeenCalledExactlyOnceWith('当前编辑目标正在保存或交接，请稍后重试');
    expect(selection.selectedId.value).toBe('a');
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
    expect(mocks.feedback.success).not.toHaveBeenCalled();
  });

  it.each(['discard', 'delete'] as const)('reports cleanup failure during %s and retains the target', async (action) => {
    const error = new Error('cleanup failed');
    const discard = vi.fn(async () => {
      throw error;
    });
    const { selection } = harness(discard);
    const pending = action === 'discard' ? selection.discardDeleted() : selection.discardMissing('a');
    await flushPromises();
    if (action === 'discard') mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    await pending;
    expect(discard).toHaveBeenCalledExactlyOnceWith('a');
    expect(mocks.feedback.error).toHaveBeenCalledExactlyOnceWith(error, '放弃战役编辑失败');
    expect(selection.selectedId.value).toBe('a');
    expect(selection.locked.value).toBe(false);
  });

  it('reports rejected input before opening a discard confirmation', async () => {
    const { selection } = harness();
    useJsonEditorStore().active!.inputs.register({
      key: 'name',
      label: 'Name',
      dirty: ref(true),
      focus: vi.fn(),
      cancel: vi.fn(),
      commit: () => 'Invalid',
    });
    await selection.discardDeleted();
    expect(mocks.feedback.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: 'commit-field-inputs' }),
      '放弃战役编辑失败',
    );
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
    expect(selection.selectedId.value).toBe('a');
  });

  it('keeps a newer selection when the old discard confirmation is accepted', async () => {
    const discard = vi.fn(async () => true);
    const { selection } = harness(discard);
    const pending = selection.discardDeleted();
    await flushPromises();
    await selection.select('b');
    mocks.feedback.confirmWarning.mock.lastCall![0].onConfirm();
    await pending;
    expect(discard).not.toHaveBeenCalled();
    expect(selection.selectedId.value).toBe('b');
  });

  it('retains the previous draft and locks through receipt acceptance', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    let finish!: () => void;
    const write = vi.fn(
      () =>
        new Promise<ReturnType<typeof savedWriteFixture>>((resolve) => {
          finish = () => resolve(savedWriteFixture());
        }),
    );
    const accept = vi.fn(async () => true);
    const pending = selection.mutate({ sessionId: 's1', modRoot: 'M:/mod', changesTarget: true, label: 'Create', write, accept });
    await flushPromises();
    expect(write).toHaveBeenCalledOnce();
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
    expect(selection.locked.value).toBe(true);
    expect(selection.writing.value).toBe(true);
    finish();
    expect(await pending).toBe(true);
    await flushPromises();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(selection.locked.value).toBe(false);
  });

  it('preserves the selection after write failure', async () => {
    const { selection } = harness();
    const action = mutation(selection);
    action.write.mockRejectedValueOnce(new Error('write failed'));
    expect(await action.run()).toBe(false);
    expect(selection.selectedId.value).toBe('a');
    expect(selection.locked.value).toBe(false);
  });

  it('waits for saving and ends a failed handoff', async () => {
    const { selection } = harness();
    let finish!: (success: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    useSaveCommandStore().registerSaveSession({
      modRoot: ref('M:/mod'),
      targetKey: ref('target'),
      saving: ref(true),
      waitForSave: () => waiting,
    });
    const pending = selection.select('b');
    expect(selection.selectedId.value).toBe('a');
    finish(false);
    await pending;
    expect(selection.selectedId.value).toBe('a');
  });

  it('preserves the current target while deleting another entity', async () => {
    const { selection, dirty } = harness();
    dirty.value = true;
    const action = mutation(selection, {
      changesTarget: false,
      accept: async () => {
        selection.reconcile(['a']);
        return true;
      },
    });
    expect(await action.run()).toBe(true);
    expect(selection.selectedId.value).toBe('a');
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it.each(['projection', 'broadcast'] as const)('keeps the project saved while retrying failed %s content work', async (step) => {
    const { selection } = harness();
    const action = mutation(selection);
    if (step === 'projection') mocks.release.mockRejectedValueOnce(new Error(step));
    else mocks.complete.mockRejectedValueOnce(new Error(step));
    expect(await action.run()).toBe(true);
    await flushPromises();
    expect(mocks.contentError).toHaveBeenCalledOnce();
    expect(mocks.feedback.success).toHaveBeenCalledOnce();
    expect(selection.selectedId.value).toBe(step === 'broadcast' ? 'b' : 'a');
    expect(useSaveCommandStore().waitForSaves('M:/mod')).toBeUndefined();
    await mocks.content!.retryContent();
    expect(selection.selectedId.value).toBe('b');
    expect(action.write).toHaveBeenCalledTimes(1);
    expect(action.accept).toHaveBeenCalledTimes(1);
  });

  it('retains receipt acceptance after a list query failure', async () => {
    const { selection } = harness();
    const accept = vi.fn(async () => false);
    const action = mutation(selection, { accept });
    expect(await action.run()).toBe(true);
    await flushPromises();
    expect(mocks.contentError).toHaveBeenCalledOnce();
    accept.mockImplementationOnce(async () => {
      selection.selectedId.value = 'b';
      return true;
    });
    expect(useSaveCommandStore().waitForSaves('M:/mod')).toBeUndefined();
    await mocks.content!.retryContent();
    expect(action.write).toHaveBeenCalledTimes(1);
    expect(selection.selectedId.value).toBe('b');
  });

  it.each(['session', 'unmount'] as const)('ends a pending discard on %s', async (ending) => {
    const { selection, sessionId, dirty } = harness();
    dirty.value = true;
    selection.reconcile(['b']);
    const pending = selection.discardDeleted();
    await flushPromises();
    if (ending === 'session') sessionId.value = 's2';
    else wrapper.unmount();
    expect(await pending).toBeUndefined();
    expect(mocks.feedback.confirmWarning).toHaveBeenCalledOnce();
  });

  it('completes a captured write without accepting presentation into a reopened session', async () => {
    const { selection, sessionId } = harness();
    let finish!: (receipt: ReturnType<typeof savedWriteFixture>) => void;
    const write = vi.fn(
      () =>
        new Promise<ReturnType<typeof savedWriteFixture>>((resolve) => {
          finish = resolve;
        }),
    );
    const accept = vi.fn(async () => true);
    const pending = selection.mutate({ sessionId: 's1', modRoot: 'M:/mod', changesTarget: true, label: 'Create', write, accept });
    await flushPromises();
    sessionId.value = 's2';
    finish(savedWriteFixture());
    expect(await pending).toBe(false);
    await flushPromises();
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(expect.anything());
    expect(accept).not.toHaveBeenCalled();
    expect(mocks.feedback.success).not.toHaveBeenCalled();
    expect(selection.selectedId.value).toBeNull();
  });

  it.each([
    ['select', 'session'],
    ['mutate', 'session'],
    ['select', 'unmount'],
    ['mutate', 'unmount'],
  ] as const)('releases a stale %s preparation error on %s', async (action, ending) => {
    const { selection, sessionId } = harness();
    let fail!: (error: Error) => void;
    vi.spyOn(useJsonEditorStore().active!.inputs, 'commit').mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const mutationAction = mutation(selection);
    const pending = action === 'select' ? selection.select('b') : mutationAction.run();
    await flushPromises();
    if (ending === 'session') sessionId.value = 's2';
    else wrapper.unmount();
    fail(new Error('old synchronization'));
    await pending;
    expect(mocks.feedback.error).not.toHaveBeenCalled();
    expect(mutationAction.write).not.toHaveBeenCalled();
    expect(selection.selectedId.value).toBe(ending === 'session' ? null : 'a');
  });
});
