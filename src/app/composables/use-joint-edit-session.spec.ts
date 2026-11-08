import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { projectChangeFixture, savedContentWorks } from '@/test/unit/project-changes';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import type { JointEditSnapshot, JointEditWriteResult, FieldProblem } from '@/shared/types';
import { AppError } from '@/shared/lib/errors';
import { shipJointFixture } from '@/test/fixtures/joint-edit/ship-joint-edit';

const mocks = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), complete: vi.fn<() => Promise<void>>(), error: vi.fn() }));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  beginSavedWrite: (await import('@/test/unit/project-changes')).withSavedCompletion(() => mocks.complete()),
}));

vi.mock('@/app/composables/use-joint-edit-actions', () => ({ useJointEditActions: () => ({ open: mocks.open, save: mocks.save }) }));
vi.mock('@/services/joint-edit.service', () => ({ queryJointEdit: (root: unknown) => mocks.open(root) }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));

import { useJointEditSession } from './use-joint-edit-session';
const root = { sessionId: 's', modRoot: 'M:/mod', kind: 'ship' as const, id: 'a' };
const snapshot: JointEditSnapshot = {
  hull: null,
  variants: {},
  catalog: null,
  newSources: [],
  root,
  bindings: {},
  referenceSettings: { values: {}, versions: [], resources: {} },
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
  it('revokes an earlier complete check when the draft changes', async () => {
    const completions: Array<(value: FieldProblem[]) => void> = [];
    const validate = vi.fn(
      (_snapshot: JointEditSnapshot, _values: unknown, signal?: AbortSignal) =>
        new Promise<FieldProblem[]>((resolve) => {
          completions.push(resolve);
          expect(signal).toBeInstanceOf(AbortSignal);
        }),
    );
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession({ validate });
        return () => null;
      },
    });
    try {
      await session.loadTarget(root);
      await flushPromises();
      session.setDraft({ ship: { state: 'present', value: 'next' } });
      await flushPromises();
      expect(validate).toHaveBeenCalledTimes(2);
      completions[1]!([{ severity: 'warning', code: 'fixture.current', path: 'next', message: 'Current' }]);
      await flushPromises();
      completions[0]!([{ severity: 'error', code: 'fixture.obsolete', path: 'before', message: 'Obsolete' }]);
      await flushPromises();
      expect(session.problems.issues.value).toMatchObject([{ code: 'fixture.current' }]);
    } finally {
      wrapper.unmount();
    }
  });
  it('reports an untouched malformed CSV value and blocks its captured save until correction', async () => {
    const graph = shipJointFixture();
    const record = graph.records.find((record) => record.key === 'csv')!;
    if (record.value.state !== 'present') throw new Error('CSV fixture');
    const csv = record.value.value as Record<string, string>;
    csv.hitpoints = 'bad-value';
    mocks.open.mockResolvedValueOnce(graph);
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession({ editableRecords: () => ['spec', 'csv', 'description'] });
        return () => null;
      },
    });
    try {
      await session.loadTarget(graph.root);
      expect(session.problems.issues.value).toMatchObject([{ code: 'csv.value_invalid', location: { field: 'hitpoints' } }]);
      const before = structuredClone(session.draftValue.value);
      await expect(session.saveDraft()).rejects.toMatchObject({ action: 'joint-validation' });
      expect(mocks.save).not.toHaveBeenCalled();
      expect(session.draftValue.value).toEqual(before);
      session.setDraft({ ...before, csv: { state: 'present', value: { ...csv, hitpoints: '320' } } });
      const actual = structuredClone(graph);
      actual.records.find((record) => record.key === 'csv')!.value = session.draftValue.value.csv!;
      mocks.save.mockResolvedValueOnce({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: graph.root }, value: actual } });
      await session.saveDraft();
      expect(session.problems.issues.value).toEqual([]);
      expect(mocks.save).toHaveBeenCalledOnce();
    } finally {
      wrapper.unmount();
    }
  });
  it('retains the failed record location and draft until correction and successful retry', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    try {
      await session.loadTarget(root);
      session.setDraft({ ship: { state: 'present', value: 'invalid' } });
      const location = { path: 'M:/mod/a.txt', field: 'settings["power"]', line: null, column: null };
      const failure = new AppError('Invalid content', { code: 'config.shape_invalid', location });
      mocks.save.mockRejectedValueOnce(failure);
      await expect(session.saveDraft()).rejects.toBe(failure);
      expect(session.problems.issues.value).toMatchObject([{ location, path: location.field, code: 'config.shape_invalid' }]);
      expect(session.draftValue.value.ship).toEqual({ state: 'present', value: 'invalid' });
      expect(session.dirty.value).toBe(true);
      expect(session.baselineSnapshot.value!.value.ship).toEqual({ state: 'present', value: 'before' });
      session.setDraft({ ship: { state: 'present', value: 'before' } });
      await flushPromises();
      expect(session.problems.issues.value).toEqual([]);
      mocks.save.mockResolvedValueOnce({ ...savedWriteFixture(), content: { target: { kind: 'joint', root }, value: snapshot } });
      await session.saveDraft();
      expect(session.dirty.value).toBe(false);
      expect(mocks.save).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });
  it('passes corrected override content once and accepts it as the actual baseline', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    await session.loadTarget(root);
    const actual = { ...snapshot, records: [{ ...snapshot.records[0]!, value: { state: 'present' as const, value: 'corrected' } }] };
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: actual.root }, value: actual } });
    await session.createOverrides(['ship'], { ship: { state: 'present', value: 'corrected' } });
    expect(mocks.save.mock.calls[0]![0].values.ship).toEqual({ state: 'present', value: 'corrected' });
    expect(session.draftValue.value.ship).toEqual({ state: 'present', value: 'corrected' });
    expect(session.dirty.value).toBe(false);
    session.setDraft({ ship: { state: 'present', value: 'next' } });
    await session.saveDraft();
    expect(mocks.save.mock.calls[1]![0].values.ship).toEqual({ state: 'present', value: 'next' });
    expect(mocks.save.mock.calls[1]![1]).toEqual([]);
    wrapper.unmount();
  });
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
    update.content.invalidation.paths = ['a.txt'];
    invalidateQueryCacheByProject('s', update.content.invalidation);
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
      },
      (value) => value,
      'identity',
    );
    mocks.open.mockResolvedValue({ ...snapshot, root: next });
    void projectChangeFixture('s', update.content.invalidation);
    await flushPromises();
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
    mocks.save.mockResolvedValue({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: snapshot.root }, value: snapshot } });
    await session.createOverrides(['ship']);
    expect(mocks.save.mock.calls[0]![0].values).toEqual({ ship: snapshot.records[0]!.value });
    expect(mocks.save.mock.calls[0]![1]).toEqual(['ship']);
    session.setDraft({ ship: { state: 'present', value: 'changed' } });
    await session.saveDraft();
    expect(mocks.save.mock.calls[1]![1]).toEqual([]);
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
    finish({ ...savedWriteFixture(), content: { target: { kind: 'joint', root: actual.root }, value: actual } });
    await pending;
    expect(session.draftValue.value.ship).toEqual({ state: 'present', value: 'later' });
    expect(session.dirty.value).toBe(true);
    wrapper.unmount();
  });
  it('keeps content retry independent from capturing and saving new input', async () => {
    let session!: ReturnType<typeof useJointEditSession>;
    const wrapper = mount({
      setup() {
        session = useJointEditSession();
        return () => null;
      },
    });
    await session.loadTarget(root);
    session.setDraft({ ship: { state: 'present', value: 'one' } });
    const receipt = { ...savedWriteFixture(), content: { target: { kind: 'joint', root: snapshot.root }, value: snapshot } };
    mocks.save.mockResolvedValue(receipt);
    mocks.complete.mockRejectedValueOnce(new Error('broadcast'));
    await session.saveDraft();
    await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('broadcast');
    expect(session.saving.value).toBe(false);
    session.setDraft({ ship: { state: 'present', value: 'two' } });
    const order: string[] = [];
    mocks.complete.mockImplementation(async () => {
      order.push('sync');
    });
    mocks.save.mockImplementation(async (draft) => {
      order.push('write');
      expect(draft.values.ship).toEqual({ state: 'present', value: 'two' });
      return { ...receipt };
    });
    await session.saveDraft();
    await savedContentWorks.at(-1)!.content;
    expect(order).toEqual(['write', 'sync']);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
