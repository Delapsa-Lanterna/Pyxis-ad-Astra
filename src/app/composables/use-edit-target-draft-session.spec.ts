import { withSavedCompletion, savedContentWorks } from '@/test/unit/project-changes';
import { describe, expect, it, vi } from 'vitest';
import { ref, watch } from 'vue';
import { useEditTargetDraftSession, type EditTargetDraftSessionOptions, type EditTargetSnapshot } from './use-edit-target-draft-session';

interface SampleValue {
  a: number;
}
interface SampleTarget {
  id: string;
}
type Snapshot = EditTargetSnapshot<SampleValue, SampleTarget, { label: string }>;
const target = { id: 't1' };
function snapshot(a: number, fingerprint = 'v1', label = 'loaded', id = target.id): Snapshot {
  return { target: { id }, value: { a }, baseVersions: [{ path: 'target.json', fingerprint }], meta: { label } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function createSession(
  options: Partial<EditTargetDraftSessionOptions<SampleValue, SampleTarget, { label: string }>> & {
    synchronizeSaved?: (snapshot: Snapshot) => void | Promise<void>;
  } = {},
) {
  const { synchronizeSaved, ...sessionOptions } = options;
  const session = useEditTargetDraftSession({
    beginSave: withSavedCompletion((value) => synchronizeSaved?.(value as Snapshot)),
    emptyValue: { a: 0 },
    targetKey: (value: SampleTarget) => value.id,
    load: () => snapshot(1),
    ...sessionOptions,
  });
  session.loadBaseForTarget(snapshot(1));
  return session;
}

describe('target snapshots', () => {
  it('clones each owned value once and isolates snapshot metadata', () => {
    const clone = vi.fn((value: SampleValue) => ({ ...value }));
    const session = createSession({ clone });
    expect(clone).toHaveBeenCalledTimes(2);
    const source = snapshot(4);
    clone.mockClear();
    session.loadBaseForTarget(source);
    expect(clone).toHaveBeenCalledTimes(2);
    source.value.a = 99;
    source.baseVersions[0]!.fingerprint = 'mutated';
    source.meta.label = 'mutated';
    expect(session.baselineSnapshot.value).toEqual(snapshot(4));
    session.draftValue.value.a = 5;
    expect(session.baselineSnapshot.value?.value.a).toBe(4);
    clone.mockClear();
    session.setDraft({ a: 6 });
    expect(clone).toHaveBeenCalledOnce();
    clone.mockClear();
    session.applyExternalForTarget(snapshot(7, 'v7'));
    expect(clone).toHaveBeenCalledOnce();
    expect(session.pendingSnapshot.value?.value.a).toBe(7);
    expect(session.draftValue.value.a).toBe(6);
  });
  it('retries content independently while retaining newer draft edits', async () => {
    const save = vi.fn((_target: SampleTarget, value: SampleValue) => snapshot(value.a));
    const synchronizeSaved = vi.fn().mockRejectedValueOnce(new Error('broadcast')).mockResolvedValue(undefined);
    const session = createSession({ save, synchronizeSaved });
    session.setDraft({ a: 2 });
    await session.saveDraft();
    await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('broadcast');
    session.setDraft({ a: 3 });
    await expect(session.waitForSave()).resolves.toBe(true);
    await savedContentWorks.at(-1)!.retryContent();
    expect(save).toHaveBeenCalledOnce();
    expect(session.draftValue.value).toEqual({ a: 3 });
    expect(session.baselineSnapshot.value?.value).toEqual({ a: 2 });
    expect(session.saving.value).toBe(false);
    expect(session.dirty.value).toBe(true);
  });
  it('saves subsequent edits while earlier content work remains unfinished', async () => {
    const save = vi.fn((_target: SampleTarget, value: SampleValue) => snapshot(value.a, 'v' + value.a));
    const synchronize = vi.fn().mockRejectedValueOnce(new Error('broadcast')).mockResolvedValueOnce(undefined);
    const session = createSession({ save, synchronizeSaved: synchronize });
    session.setDraft({ a: 2 });
    await session.saveDraft();
    await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('broadcast');
    expect(session.saving.value).toBe(false);
    session.setDraft({ a: 3 });
    await session.saveDraft();
    expect(save).toHaveBeenCalledTimes(2);
    await savedContentWorks.at(-1)!.content;
    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(session.draftValue.value).toEqual({ a: 3 });
    expect(session.dirty.value).toBe(false);
  });
  it('accepts identity credentials and preserves raw fields and current draft in one handoff', () => {
    const session = createSession();
    const raw = ref(true);
    const cancel = vi.fn();
    session.inputs.register({ key: 'a', label: 'a', dirty: raw, commit: () => null, focus: vi.fn(), cancel });
    session.setDraft({ a: 7 });
    expect(session.adoptIdentity(target, snapshot(2, 'v2', 'next', 'next'), (draft) => draft)).toBe(true);
    expect(session.currentTarget.value).toEqual({ id: 'next' });
    expect(session.baselineSnapshot.value?.baseVersions).toEqual([{ path: 'target.json', fingerprint: 'v2' }]);
    expect(session.draftValue.value).toEqual({ a: 7 });
    expect(raw.value).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(session.context.value?.handoff).toBe('external');
  });
  it('publishes the mapped draft in the same notification as the renamed baseline', () => {
    const session = createSession();
    session.setDraft({ a: 7 });
    const observed: Array<{ id: string; draft: number }> = [];
    const stop = watch(
      session.baselineSnapshot,
      (value) => {
        observed.push({ id: value!.target.id, draft: session.draftValue.value.a });
      },
      { flush: 'sync' },
    );
    session.adoptIdentity(target, snapshot(2, 'v2', 'next', 'next'), () => ({ a: 9 }));
    expect(observed).toEqual([{ id: 'next', draft: 9 }]);
    stop();
  });
  it('owns isolated draft, baseline, versions and metadata', () => {
    const session = createSession();
    const draft = { a: 2 };
    session.setDraft(draft);
    draft.a = 99;
    expect(session.draftValue.value).toEqual({ a: 2 });
    expect(session.baselineSnapshot.value).toEqual(snapshot(1));
    expect(session.dirty.value).toBe(true);
    session.setDraft({ a: 1 });
    expect(session.dirty.value).toBe(false);
  });
  it('stages a complete external snapshot and accepts it atomically', () => {
    const session = createSession();
    session.setDraft({ a: 2 });
    expect(session.applyExternalForTarget(snapshot(3, 'v3', 'external'))).toBe('pending');
    expect(session.pendingSnapshot.value).toEqual(snapshot(3, 'v3', 'external'));
    expect(session.baselineSnapshot.value).toEqual(snapshot(1));
    session.loadPendingExternal();
    expect(session.baselineSnapshot.value).toEqual(snapshot(3, 'v3', 'external'));
    expect(session.draftValue.value).toEqual({ a: 3 });
    expect(session.context.value?.handoff).toBe('external');
    expect(session.dirty.value).toBe(false);
  });
  it('advances generation for same content with a new version', () => {
    const session = createSession();
    const generation = session.context.value!.baselineGeneration;
    session.applyExternalForTarget(snapshot(1, 'v2'));
    expect(session.context.value!.baselineGeneration).toBe(generation + 1);
    expect(session.baselineSnapshot.value!.baseVersions).toEqual(snapshot(1, 'v2').baseVersions);
  });
  it('refreshes metadata without breaking the edit context for the same baseline', () => {
    const session = createSession();
    const context = session.context.value;
    session.setDraft({ a: 2 });
    session.applyExternalForTarget(snapshot(1, 'v1', 'hydrated'));
    expect(session.baselineSnapshot.value?.meta.label).toBe('hydrated');
    expect(session.context.value).toBe(context);
    expect(session.draftValue.value).toEqual({ a: 2 });
  });
  it('rejects other targets and releases pending inputs on reset', () => {
    const session = createSession();
    expect(session.applyExternalForTarget(snapshot(9, 'v9', '', 'other'))).toBe('obsolete');
    const raw = ref(true);
    const cancel = vi.fn(() => {
      raw.value = false;
    });
    session.inputs.register({ key: 'a', label: 'a', dirty: raw, commit: () => null, cancel, focus: vi.fn() });
    session.resetDraft();
    expect(cancel).toHaveBeenCalledOnce();
    expect(session.dirty.value).toBe(false);
    expect(session.context.value?.handoff).toBe('reset');
  });

  it('accepts the delivered order and keeps metadata with its content', () => {
    const session = createSession();
    expect(session.applyExternalForTarget({ ...snapshot(2, 'v2') })).toBe('baseline');
    session.applyExternalForTarget(snapshot(2, 'v2', 'hydrated'));
    expect(session.applyExternalForTarget({ ...snapshot(1) })).toBe('baseline');
    expect(session.baselineSnapshot.value?.value).toEqual({ a: 1 });
    expect(session.baselineSnapshot.value?.meta.label).toBe('loaded');
  });
});

describe('read acceptance', () => {
  it.each(['resolve', 'reject'] as const)('revokes a pre-save read %s', async (completion) => {
    const read = deferred<Snapshot>();
    const session = createSession({ load: () => read.promise, save: () => snapshot(2, 'v2', 'saved') });
    const loading = session.refreshTarget(target);
    session.setDraft({ a: 2 });
    await session.saveDraft();
    if (completion === 'resolve') read.resolve(snapshot(1));
    else read.reject(new Error('late error'));
    expect(await loading).toBeNull();
    expect(session.baselineSnapshot.value).toEqual(snapshot(2, 'v2', 'saved'));
    expect(session.loading.value).toBe(false);
  });
  it('allows save while an already-ready target refreshes', async () => {
    const read = deferred<Snapshot>();
    const save = vi.fn(() => snapshot(1, 'v2'));
    const session = createSession({ load: () => read.promise, save });
    const loading = session.refreshTarget(target);
    await session.saveDraft();
    expect(save).toHaveBeenCalledOnce();
    read.resolve(snapshot(9));
    expect(await loading).toBeNull();
  });
  it('accepts only the latest request and ignores errors after disposal', async () => {
    const first = deferred<Snapshot>();
    const second = deferred<Snapshot>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const session = createSession({ load });
    const one = session.refreshTarget(target);
    const two = session.refreshTarget(target);
    first.resolve(snapshot(8));
    expect(await one).toBeNull();
    expect(session.loading.value).toBe(true);
    session.dispose();
    second.reject(new Error('disposed'));
    expect(await two).toBeNull();
    expect(session.currentTarget.value).toBeNull();
  });
  it('clears readiness while switching to a new target', async () => {
    const read = deferred<Snapshot>();
    const save = vi.fn();
    const session = createSession({ load: () => read.promise, save });
    const loading = session.loadTarget({ id: 't2' });
    expect(session.baselineSnapshot.value).toBeNull();
    expect(await session.saveDraft()).toBeNull();
    expect(save).not.toHaveBeenCalled();
    read.resolve(snapshot(4, 'v4', '', 't2'));
    await loading;
    expect(session.currentTarget.value).toEqual({ id: 't2' });
  });
});

describe('save operation', () => {
  it.each(['accept', 'synchronize', 'refresh'] as const)('retries an unfinished %s phase and reports completion once', async (phase) => {
    const written = snapshot(2, 'v2');
    const write = deferred<Snapshot>();
    const save = vi.fn(() => write.promise);
    const acceptSaved = vi.fn(async () => {});
    const synchronizeSaved = vi.fn(async () => {});
    const load = vi.fn(async () => written);
    const afterSaved = vi.fn();
    const failure = new Error('unfinished phase');
    if (phase === 'accept') acceptSaved.mockRejectedValueOnce(failure);
    if (phase === 'synchronize') synchronizeSaved.mockRejectedValueOnce(failure);
    if (phase === 'refresh') load.mockRejectedValueOnce(failure);
    const session = createSession({ save, acceptSaved, synchronizeSaved, load, afterSaved });
    session.setDraft({ a: 2 });
    const pending = session.saveDraft();
    const refresh = session.refreshTarget(target);
    session.setDraft({ a: 3 });
    write.resolve(written);
    await pending;
    await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('unfinished phase');
    await refresh;
    expect(afterSaved).toHaveBeenCalledOnce();
    expect(session.saving.value).toBe(false);
    expect(await session.waitForSave()).toBe(true);
    await savedContentWorks.at(-1)!.retryContent();
    expect(save).toHaveBeenCalledOnce();
    expect(acceptSaved).toHaveBeenCalledTimes(phase === 'accept' ? 2 : 1);
    expect(synchronizeSaved).toHaveBeenCalledTimes(phase === 'synchronize' ? 2 : 1);
    expect(load).toHaveBeenCalledTimes(phase === 'refresh' ? 2 : 1);
    expect(afterSaved).toHaveBeenCalledExactlyOnceWith(written);
    expect(session.baselineSnapshot.value).toEqual(written);
    expect(session.draftValue.value).toEqual({ a: 3 });
  });

  it('reuses one promise and keeps edits against actual persisted content', async () => {
    const write = deferred<Snapshot>();
    const save = vi.fn(() => write.promise);
    const session = createSession({ save });
    session.setDraft({ a: 2 });
    const pending = session.saveDraft();
    expect(session.saveDraft()).toBe(pending);
    session.setDraft({ a: 9 });
    write.resolve(snapshot(20, 'v2', 'persisted'));
    await pending;
    expect(save).toHaveBeenCalledWith(target, { a: 2 }, snapshot(1).baseVersions, { a: 1 }, undefined);
    expect(session.baselineSnapshot.value).toEqual(snapshot(20, 'v2', 'persisted'));
    expect(session.draftValue.value).toEqual({ a: 9 });
    expect(session.pendingSnapshot.value).toBeNull();
    expect(session.externalUpdateNotice.value).toBe('');
    expect(session.dirty.value).toBe(true);
    session.resetDraft();
    expect(session.draftValue.value).toEqual({ a: 20 });
  });
  it('accepts canonical content when no newer edit exists', async () => {
    const session = createSession({ save: () => snapshot(20, 'v2') });
    session.setDraft({ a: 2 });
    await session.saveDraft();
    expect(session.draftValue.value).toEqual({ a: 20 });
    expect(session.dirty.value).toBe(false);
    expect(session.context.value?.handoff).toBe('save');
  });
  it.each(['write', 'sync', 'cancel'] as const)('ends handoff on %s failure and retains the correct baseline', async (stage) => {
    const session = createSession({
      save: () => {
        if (stage === 'write') throw new Error('write');
        if (stage === 'cancel') return;
        return snapshot(2, 'v2');
      },
      synchronizeSaved: () => {
        if (stage === 'sync') throw new Error('sync');
      },
    });
    session.setDraft({ a: 2 });
    const pending = session.saveDraft();
    const waiting = session.waitForSave();
    if (stage === 'cancel') expect(await pending).toBeNull();
    else if (stage === 'write') await expect(pending).rejects.toThrow('write');
    else {
      await pending;
      await expect(savedContentWorks.at(-1)!.content).rejects.toThrow('sync');
    }
    expect(await waiting).toBe(stage === 'sync');
    expect(session.baselineSnapshot.value?.value.a).toBe(stage === 'sync' ? 2 : 1);
    expect(session.saving.value).toBe(false);
  });
  it('commits inputs before capturing and retains later raw input', async () => {
    const write = deferred<Snapshot>();
    const session = createSession({ save: () => write.promise });
    const raw = ref(true);
    session.inputs.register({
      key: 'a',
      label: 'a',
      dirty: raw,
      commit: () => {
        session.setDraft({ a: 2 });
        raw.value = false;
        return null;
      },
      cancel: () => {},
      focus: () => {},
    });
    const pending = session.saveDraft();
    await Promise.resolve();
    await Promise.resolve();
    raw.value = true;
    write.resolve(snapshot(2, 'v2'));
    await pending;
    expect(session.dirty.value).toBe(true);
    expect(raw.value).toBe(true);
  });
  it('coalesces refresh requests and reads after saved synchronization', async () => {
    const write = deferred<Snapshot>();
    const load = vi.fn(() => snapshot(3, 'v3'));
    const session = createSession({ load, save: () => write.promise });
    const pending = session.saveDraft();
    const refresh1 = session.refreshTarget(target);
    const refresh2 = session.refreshTarget(target);
    session.setDraft({ a: 9 });
    write.resolve(snapshot(2, 'v2'));
    await Promise.all([pending, refresh1, refresh2]);
    expect(load).toHaveBeenCalledOnce();
    expect(session.baselineSnapshot.value).toEqual(snapshot(2, 'v2'));
    expect(session.pendingSnapshot.value).toEqual(snapshot(3, 'v3'));
    expect(session.draftValue.value).toEqual({ a: 9 });
  });
  it('accepts a preceding queued save read while preserving its own captured draft', async () => {
    const write = deferred<Snapshot>();
    const load = vi.fn(() => snapshot(3, 'v3'));
    const session = createSession({ load, save: () => write.promise });
    session.setDraft({ a: 7 });
    const pending = session.saveDraft();
    await session.refreshTarget(target, true);
    expect(load).toHaveBeenCalledOnce();
    expect(session.pendingSnapshot.value).toEqual(snapshot(3, 'v3'));
    expect(session.draftValue.value).toEqual({ a: 7 });
    write.resolve(snapshot(7, 'v7'));
    await pending;
    expect(session.baselineSnapshot.value).toEqual(snapshot(7, 'v7'));
  });
  it('completes captured synchronization after consumer disposal', async () => {
    const write = deferred<Snapshot>();
    const synchronizeSaved = vi.fn();
    const session = createSession({ save: () => write.promise, synchronizeSaved });
    const pending = session.saveDraft();
    session.dispose();
    write.resolve(snapshot(2, 'v2'));
    await pending;
    expect(synchronizeSaved).toHaveBeenCalledWith(snapshot(2, 'v2'));
    expect(session.baselineSnapshot.value).toBeNull();
  });
  it('retains a newer draft when formal content confirms the saved value', async () => {
    const session = createSession({ save: () => ({ ...snapshot(2, 'v2') }) });
    await session.saveDraft();
    session.setDraft({ a: 3 });
    expect(session.applyExternalForTarget({ ...snapshot(2, 'v2') })).toBe('baseline');
    expect(session.pendingSnapshot.value).toBeNull();
  });
});

describe('captured save contents', () => {
  it('writes the captured 100 while draft undo retains 80 during preparation', async () => {
    const prepare = deferred<void>();
    const write = vi.fn((_target: SampleTarget, value: SampleValue) => snapshot(value.a));
    const session = createSession({
      save: write,
      confirmSave: async () => {
        await prepare.promise;
        return true;
      },
    });
    session.setDraft({ a: 100 });
    const saving = session.saveDraft();
    session.setDraft({ a: 80 });
    prepare.resolve();
    await saving;
    expect(write.mock.calls[0]![1]).toEqual({ a: 100 });
    expect(session.baselineSnapshot.value?.value).toEqual({ a: 100 });
    expect(session.draftValue.value).toEqual({ a: 80 });
    expect(session.dirty.value).toBe(true);
  });
});
