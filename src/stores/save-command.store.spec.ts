import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createFieldInputs } from '@/shared/runtime/field-inputs';

import { useSaveCommandStore } from './save-command.store';
import type { EditWriteTarget } from '@/shared/types';

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
          save: async () => ({ saved: true, receipt: null }),
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
          save: async () => ({ saved: true, receipt: null }),
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
