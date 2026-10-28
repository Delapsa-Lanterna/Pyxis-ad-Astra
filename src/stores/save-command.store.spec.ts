import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createFieldInputs } from '@/shared/runtime/field-inputs';

import { useSaveCommandStore, type SaveSessionHandle } from './save-command.store';
import { flushPromises } from '@vue/test-utils';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import { appLogQueue } from '@/shared/runtime/app-log-queue';
import { useProjectSyncStore } from './project-sync.store';

describe('useSaveCommandStore', () => {
  it('waits for the registered save while dispatching the active action', async () => {
    const commands = useSaveCommandStore();
    const saving = ref(true);
    const retry = vi.fn(async () => {
      saving.value = false;
      return true;
    });
    commands.registerSaveSession({
      targetKey: ref('target'),
      modRoot: ref('M:/mod'),
      saving,
      waitForSave: retry,
    });
    const handler = vi.fn();
    commands.registerActiveSaveHandler(handler);
    expect(commands.hasPendingSave('M:/mod')).toBe(true);
    commands.dispatchSaveCommand();
    expect(handler).toHaveBeenCalledOnce();
    await expect(commands.waitForSaves('M:/mod')).resolves.toBe(true);
    expect(retry).toHaveBeenCalledOnce();
    expect(commands.hasPendingSave('M:/mod')).toBe(false);
  });
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts without an active save handler', () => {
    const store = useSaveCommandStore();
    expect(store.dispatchSaveCommand()).toBe(false);
  });

  it('dispatches to the registered handler', () => {
    const store = useSaveCommandStore();
    const handler = vi.fn();
    store.registerActiveSaveHandler(handler);
    expect(store.dispatchSaveCommand()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unregisters only the matching handler instance', () => {
    const store = useSaveCommandStore();
    const first = vi.fn();
    const second = vi.fn();
    store.registerActiveSaveHandler(first);
    store.unregisterActiveSaveHandler(second);
    expect(store.dispatchSaveCommand()).toBe(true);

    store.unregisterActiveSaveHandler(first);
    expect(store.dispatchSaveCommand()).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('keeps exactly one active handler at a time', () => {
    const store = useSaveCommandStore();
    const first = vi.fn();
    const second = vi.fn();
    store.registerActiveSaveHandler(first);
    store.registerActiveSaveHandler(second);
    store.dispatchSaveCommand();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
  it.each(['target', 'draft', 'dirty', 'input lifecycle', 'registration'] as const)(
    'invalidates a close snapshot when its %s changes',
    (change) => {
      const commands = useSaveCommandStore();
      const targetKey = ref('one'),
        dirty = ref(false),
        draftValue = ref({ value: 1 });
      const inputs = createFieldInputs(targetKey);
      const handle = {
        targetKey,
        modRoot: ref('M:/mod'),
        saving: ref(false),
        waitForSave: async () => true,
        editing: {
          targets: ref([]),
          label: 'test',
          dirty,
          draftSession: { draftValue, inputs },
          save: async () => ({ status: 'noop' as const }),
        },
      };
      const unregister = commands.registerSaveSession(handle);
      const accepts = commands.captureCloseState();
      expect(accepts()).toBe(true);
      if (change === 'target') targetKey.value = 'two';
      if (change === 'draft') draftValue.value.value++;
      if (change === 'dirty') dirty.value = true;
      if (change === 'input lifecycle') inputs.cancel();
      if (change === 'registration') {
        unregister();
        commands.registerSaveSession({ ...handle });
      }
      expect(accepts()).toBe(false);
    },
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function participant(id: string, run: () => Promise<DocumentSaveResult>, root = 'M:/one') {
  const handle: SaveSessionHandle = {
    targetKey: ref(id),
    modRoot: ref(root),
    saving: ref(false),
    waitForSave: async () => true,
    editing: {
      label: id,
      targets: ref([]),
      dirty: ref(true),
      draftSession: { draftValue: ref({}), inputs: createFieldInputs() },
      save: vi.fn(run),
    },
  };
  const release = useSaveCommandStore().registerSaveSession(handle);
  return { handle, release, save: () => useSaveCommandStore().requestSave(handle) };
}
describe('document save queue', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('records queue and completion state at debug level without input values', async () => {
    const entries: string[] = [];
    appLogQueue.install(async (batch) => {
      entries.push(...batch.map((entry) => entry.code ?? ''));
    }, vi.fn());
    appLogQueue.setLevel('debug');
    const item = participant('JSON', async () => ({ status: 'noop' }));
    await item.save();
    await appLogQueue.flush();
    expect(entries).toEqual(['save.queued', 'save.started', 'save.completed']);
    appLogQueue.setLevel('info');
  });
  it('captures each document immediately and delegates file ordering to the native queue', async () => {
    const first = deferred<DocumentSaveResult>(),
      second = deferred<DocumentSaveResult>();
    const order: string[] = [];
    const a = participant('CSV', async () => {
      order.push('CSV');
      return first.promise;
    });
    const raw = ref('queued');
    const b = participant('JSON', async () => {
      order.push(raw.value);
      return second.promise;
    });
    const savingA = a.save(),
      savingB = b.save(),
      repeated = b.save();
    expect(order).toEqual(['CSV', 'queued']);
    raw.value = 'latest';
    first.resolve({ status: 'saved', receipt: savedWriteFixture() });
    await savingA;
    await flushPromises();
    expect(order).toEqual(['CSV', 'queued']);
    second.resolve({ status: 'noop' });
    expect(await savingB).toEqual(await repeated);
    expect(b.handle.editing!.save).toHaveBeenCalledOnce();
    expect(useSaveCommandStore().hasPendingSave()).toBe(false);
  });
  it.each(['cancel', 'fail'] as const)('%s ends the appropriate requests and continues other Mods', async (outcome) => {
    const first = deferred<DocumentSaveResult>();
    const a = participant('A', () => first.promise);
    const b = participant('B', async () => ({ status: 'noop' }));
    const c = participant('C', async () => ({ status: 'noop' }), 'M:/two');
    const savingA = a.save(),
      savingB = b.save(),
      savingC = c.save();
    const expectedA =
      outcome === 'fail' ? expect(savingA).rejects.toThrow('disk') : expect(savingA).resolves.toEqual({ status: 'cancelled' });
    if (outcome === 'fail') first.reject(new Error('disk'));
    else first.resolve({ status: 'cancelled' });
    await expectedA;
    expect(await savingB).toEqual({ status: 'noop' });
    expect(await savingC).toEqual({ status: 'noop' });
    expect(b.handle.editing!.save).toHaveBeenCalledOnce();
    expect(c.handle.editing!.save).toHaveBeenCalledOnce();
  });

  it('waits for saves added during the wait and their synchronization', async () => {
    const gate = deferred<DocumentSaveResult>(),
      later = deferred<DocumentSaveResult>();
    const commands = useSaveCommandStore();
    const a = participant('A', () => gate.promise),
      b = participant('B', () => later.promise, 'M:/two');
    const savingA = a.save();
    let finished = false;
    const waiting = commands.waitForSaves()!.then((result) => {
      finished = true;
      return result;
    });
    const savingB = b.save();
    gate.resolve({ status: 'noop' });
    await savingA;
    await flushPromises();
    expect(finished).toBe(false);
    later.resolve({ status: 'noop' });
    await savingB;
    expect(await waiting).toBe(true);
  });
  it('releases a close wait on a disk failure while retaining the active save for retry', async () => {
    const commands = useSaveCommandStore();
    const gate = deferred<DocumentSaveResult>();
    const item = participant('A', () => gate.promise);
    const saving = item.save();
    const waiting = commands.waitForSaves();
    useProjectSyncStore().setBlocked({
      kind: 'blocked',
      requestId: 'disk',
      modRoot: item.handle.modRoot.value!,
      sessionId: 's',
      diagnostic: { code: 'io.unexpected', message: 'disk', location: null },
    });
    await expect(waiting).resolves.toBe(false);
    expect(commands.hasPendingSave()).toBe(true);
    useProjectSyncStore().setWaiting(item.handle.modRoot.value!, true);
    gate.resolve({ status: 'saved', receipt: savedWriteFixture() });
    await saving;
    expect(commands.hasPendingSave()).toBe(false);
  });
});
