import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savedWriteFixture } from '@/test/write-result';
import type { JointEditSnapshot, JointEditWriteResult } from '@/shared/types';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { sessionUpdateFixture } from '@/test/write-result';
import type { ProjectSessionInvalidatedEvent } from '@/windows/window.events';
const mocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), complete: vi.fn(), error: vi.fn(), projection: vi.fn() }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({ listenProjectSessionInvalidated: mocks.projection }));
vi.mock('@/app/composables/use-joint-edit-actions', () => ({ useJointEditActions: () => ({ open: mocks.open, save: mocks.save }) }));
vi.mock('@/services/joint-edit.service', () => ({ queryJointEdit: (root: unknown) => mocks.open(root) }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/orchestrators/file-history-write.orchestrator', () => ({ completeSavedWrite: mocks.complete }));
import { useJointEditSession } from './use-joint-edit-session';
const root = { sessionId: 's', modRoot: 'M:/mod', kind: 'ship' as const, id: 'a' };
const snapshot: JointEditSnapshot = {
  root,
  bindings: {},
  referenceSettings: { values: {}, versions: [] },
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
  mocks.projection.mockResolvedValue(() => {});
});
describe('joint snapshot session acceptance', () => {
  it('waits for the projection notification after identity acceptance before rereading the root', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    await session.loadTarget(root);
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    update.projection.invalidation.paths = ['a.txt'];
    invalidateQueryCacheByProject('s', update.projection.invalidation);
    await flushPromises();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    const next = { ...root, id: 'renamed' };
    session.adoptIdentity(
      root,
      {
        target: next,
        value: session.draftValue.value,
        baseVersions: [],
        meta: { snapshot: { ...snapshot, root: next }, receipt: null, previous: null },
        commitId: 1,
      },
      (value) => value,
      'identity',
    );
    mocks.open.mockResolvedValue({ ...snapshot, root: next });
    const notify = mocks.projection.mock.calls[0]![0] as (event: ProjectSessionInvalidatedEvent) => Promise<void>;
    await notify(update.projection);
    expect(mocks.open).toHaveBeenLastCalledWith(next);
    wrapper.unmount();
  });
  it('limits draft and save scopes to declared editable records and passes explicit override intent', async () => {
    const associated = { ...snapshot.records[0]!, key: 'associated' };
    mocks.open.mockResolvedValue({ ...snapshot, records: [...snapshot.records, associated] });
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession({ editableRecords: () => ['ship'] });
        return () => null;
      },
    });
    await session.loadTarget(root);
    expect(Object.keys(session.draftValue.value)).toEqual(['ship']);
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), refreshedEntity: snapshot });
    await session.createOverrides(['ship']);
    expect(mocks.save.mock.calls[0]![0].values).toEqual({ ship: snapshot.records[0]!.value });
    expect(mocks.save.mock.calls[0]![3]).toEqual(['ship']);
    session.setDraft({ ship: { state: 'present', value: 'changed' } });
    await session.saveDraft();
    expect(mocks.save.mock.calls[1]![3]).toEqual([]);
    wrapper.unmount();
  });
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
