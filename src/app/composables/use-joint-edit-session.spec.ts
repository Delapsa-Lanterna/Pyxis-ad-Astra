import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savedWriteFixture } from '@/test/write-result';
import type { JointEditSnapshot, JointEditWriteResult } from '@/shared/types';
const mocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), complete: vi.fn(), error: vi.fn() }));
vi.mock('@/app/composables/use-joint-edit-actions', () => ({ useJointEditActions: () => ({ open: mocks.open, save: mocks.save }) }));
vi.mock('@/services/joint-edit.service', () => ({ queryJointEdit: (root: unknown) => mocks.open(root) }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/orchestrators/file-history-write.orchestrator', () => ({ completeSavedWrite: mocks.complete }));
import { useJointEditSession } from './use-joint-edit-session';
const root = { sessionId: 's', modRoot: 'M:/mod', kind: 'ship' as const, id: 'a' };
const snapshot: JointEditSnapshot = {
  root,
  records: [
    {
      key: 'ship',
      target: { kind: 'text', write: { source: 'mod', root: 'M:/mod', relPath: 'a.txt', path: 'M:/mod/a.txt' } },
      source: null,
      sourceVersion: null,
      value: { state: 'present', value: 'before' },
      baseVersions: [],
      resourceRefs: {},
      referencedBy: [],
    },
  ],
  baseVersions: [],
};
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.open.mockResolvedValue(snapshot);
  mocks.complete.mockResolvedValue(undefined);
});
describe('joint snapshot session acceptance', () => {
  it('ends opening on unmount and ignores the late snapshot', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    let finish!: (value: JointEditSnapshot) => void;
    mocks.open.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = session.open(root);
    const signal = mocks.open.mock.calls[0]![1] as AbortSignal;
    wrapper.unmount();
    await expect(pending).resolves.toBe(false);
    expect(signal.aborted).toBe(true);
    finish(snapshot);
    await flushPromises();
    expect(session.currentTarget.value).toBeNull();
    expect(session.baselineSnapshot.value).toBeNull();
  });
  it('accepts only the latest opening when targets change', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    let finish!: (value: JointEditSnapshot) => void;
    mocks.open.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const first = session.open(root);
    const next = { ...root, id: 'b' };
    mocks.open.mockResolvedValueOnce({ ...snapshot, root: next });
    await expect(session.open(next)).resolves.toBe(true);
    await expect(first).resolves.toBe(false);
    finish(snapshot);
    await flushPromises();
    expect(session.currentTarget.value).toEqual(next);
    wrapper.unmount();
  });
  it('accepts the actual baseline before synchronization and preserves input made during save', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    await session.loadTarget(root);
    session.setDraft({ ship: { state: 'present', value: 'submitted' } });
    let finish!: (result: JointEditWriteResult) => void;
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = session.saveDraft();
    await flushPromises();
    session.setDraft({ ship: { state: 'present', value: 'later' } });
    const actual = { ...snapshot, records: [{ ...snapshot.records[0]!, value: { state: 'present' as const, value: 'actual' } }] };
    mocks.complete.mockImplementationOnce(async () => {
      expect(session.baselineSnapshot.value!.value.ship).toEqual({ state: 'present', value: 'actual' });
    });
    finish({ ...savedWriteFixture(), refreshedEntity: actual });
    await pending;
    expect(session.draftValue.value.ship).toEqual({ state: 'present', value: 'later' });
    expect(session.dirty.value).toBe(true);
    wrapper.unmount();
  });
  it('retries the original receipt before capturing and writing new input', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    await session.loadTarget(root);
    session.setDraft({ ship: { state: 'present', value: 'one' } });
    const receipt = { ...savedWriteFixture(), refreshedEntity: snapshot };
    mocks.save.mockResolvedValue(receipt);
    mocks.complete.mockRejectedValueOnce(new Error('broadcast'));
    await expect(session.saveDraft()).rejects.toThrow();
    expect(session.hasPendingSynchronization.value).toBe(true);
    session.setDraft({ ship: { state: 'present', value: 'two' } });
    const order: string[] = [];
    mocks.complete.mockImplementation(async () => {
      order.push('sync');
    });
    mocks.save.mockImplementation(async (draft) => {
      order.push('write');
      expect(draft.values.ship).toEqual({ state: 'present', value: 'two' });
      return { ...receipt, commitId: 2 };
    });
    await session.saveDraft();
    expect(order).toEqual(['sync', 'write', 'sync']);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
