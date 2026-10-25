import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createFieldInputs } from '@/shared/runtime/field-inputs';

import { useSaveCommandStore, type SaveSessionHandle } from './save-command.store';
import { flushPromises } from '@vue/test-utils';
import { savedWriteFixture } from '@/test/write-result';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { EditWriteTarget } from '@/shared/types';
import { appLogQueue } from '@/shared/runtime/app-log-queue';

describe('useSaveCommandStore', () => {
  it('waits for pending synchronization and allows the active save to trigger its retry', async () => {
    const commands = useSaveCommandStore();
    const pendingSynchronization = ref(true);
    const retry = vi.fn(async () => {
      pendingSynchronization.value = false;
      return true;
    });
    commands.registerSaveSession({
      targetKey: ref('target'),
      modRoot: ref('M:/mod'),
      saving: ref(false),
      pendingSynchronization,
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
  it('matches complete participant scopes and releases registrations and held locks', () => {
    const commands = useSaveCommandStore();
    const target = { sessionId: 'session', modRoot: 'M:/mod', path: 'M:/mod/data/ships.csv' };
    const releases = [vi.fn(), vi.fn()];
    function register(key: string, targets: EditWriteTarget[], index = 0) {
      return commands.registerSaveSession({
        targetKey: ref(key),
        modRoot: ref(target.modRoot),
        saving: ref(false),
        waitForSave: async () => true,
        editing: {
          targets: ref(targets),
          label: key,
          dirty: ref(false),
          draftSession: { draftValue: ref({}), inputs: createFieldInputs() },
          save: async () => ({ status: 'noop' as const }),
          hold: () => releases[index]!,
        },
      });
    }
    const unregisterFile = register('file', [target]);
    register('directory', [{ ...target, path: 'm:\\MOD\\data\\' }], 1);
    register('other-session', [{ ...target, sessionId: 'other' }]);
    register('other-mod', [{ ...target, modRoot: 'M:/other' }]);
    register('prefix', [{ ...target, path: 'M:/mod/data/ships.csv.copy' }]);
    const handles = commands.participantsForTargets([target]);
    expect(handles.map((handle) => handle.targetKey.value).sort()).toEqual(['directory', 'file']);
    const release = commands.holdParticipants(handles, 'request');
    expect(commands.isEditTargetLocked('file')).toBe(true);
    expect(commands.isEditTargetLocked('directory')).toBe(true);
    unregisterFile();
    expect(commands.isEditTargetLocked('file')).toBe(false);
    expect(commands.participantsForTargets([target]).map((handle) => handle.targetKey.value)).toEqual(['directory']);
    release();
    expect(commands.isEditTargetLocked('directory')).toBe(false);
    releases.forEach((callback) => expect(callback).toHaveBeenCalledOnce());
  });
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
  it('serializes different documents and reads the latest input when its turn begins', async () => {
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
    expect(order).toEqual(['CSV']);
    raw.value = 'latest';
    first.resolve({ status: 'saved', receipt: savedWriteFixture() });
    await savingA;
    await flushPromises();
    expect(order).toEqual(['CSV', 'latest']);
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
    expect(await savingB).toEqual({ status: outcome === 'fail' ? 'cancelled' : 'noop' });
    expect(await savingC).toEqual({ status: 'noop' });
    expect(b.handle.editing!.save).toHaveBeenCalledTimes(outcome === 'fail' ? 0 : 1);
    expect(c.handle.editing!.save).toHaveBeenCalledOnce();
  });
  it('fulfills an already queued prerequisite through the same result while its parent is running', async () => {
    const gate = deferred<void>(),
      commands = useSaveCommandStore();
    const result: DocumentSaveResult = { status: 'saved', receipt: savedWriteFixture() };
    const b = participant('B', async () => result);
    const a = participant('A', async () => {
      await gate.promise;
      const prepared = await commands.savePreparedParticipant(b.handle, 'A');
      expect(prepared).toEqual(result);
      return { status: 'noop' };
    });
    const savingA = a.save(),
      savingB = b.save();
    gate.resolve();
    expect(await savingA).toEqual({ status: 'noop' });
    expect(await savingB).toEqual(result);
    expect(b.handle.editing!.save).toHaveBeenCalledOnce();
    expect(commands.isPreparingParticipant('B')).toBe(false);
  });
  it('queues remote preparation behind an unrelated document save', async () => {
    const gate = deferred<DocumentSaveResult>(),
      commands = useSaveCommandStore();
    const a = participant('A', () => gate.promise),
      b = participant('B', async () => ({ status: 'noop' }));
    const savingA = a.save(),
      savingB = commands.savePreparedParticipant(b.handle);
    await flushPromises();
    expect(b.handle.editing!.save).not.toHaveBeenCalled();
    gate.resolve({ status: 'noop' });
    await savingA;
    expect(await savingB).toEqual({ status: 'noop' });
    expect(b.handle.editing!.save).toHaveBeenCalledOnce();
  });
  it('joins a running prerequisite and cancels a queued request when its session is released', async () => {
    const gate = deferred<DocumentSaveResult>(),
      commands = useSaveCommandStore();
    const a = participant('A', () => gate.promise),
      b = participant('B', async () => ({ status: 'noop' }));
    const savingA = a.save(),
      joiningA = commands.savePreparedParticipant(a.handle),
      savingB = b.save();
    b.release();
    expect(await savingB).toEqual({ status: 'cancelled' });
    gate.resolve({ status: 'noop' });
    expect(await savingA).toEqual(await joiningA);
    expect(a.handle.editing!.save).toHaveBeenCalledOnce();
    expect(b.handle.editing!.save).not.toHaveBeenCalled();
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
});
