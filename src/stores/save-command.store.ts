import { ref, shallowReactive, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { computed } from 'vue';
import type { EditWriteTarget } from '@/shared/types';
import { editTargetsOverlap } from '@/domain/joint-edit';

type SaveHandler = () => void | Promise<void>;

interface SaveSessionHandle {
  targetKey: Readonly<Ref<string | null>>;
  modRoot: Readonly<Ref<string | null>>;
  saving: Readonly<Ref<boolean>>;
  pendingSynchronization?: Readonly<Ref<boolean>>;
  waitForSave: () => Promise<boolean>;
  editing?: EditParticipant;
}

export interface EditParticipant {
  targets: Readonly<Ref<EditWriteTarget[]>>;
  label: string;
  dirty: Readonly<Ref<boolean>>;
  commitInputs: () => Promise<boolean> | boolean | undefined;
  save: () => Promise<{ saved: boolean; receipt: import('@/shared/types').WriteResult<unknown> | null }>;
  hold?: (requestId: string) => () => void;
}

// Registry of the active Ctrl+S save target in the main window: exactly one surface
// holds the save right at a time.
export const useSaveCommandStore = defineStore('save-command', () => {
  const activeHandler = ref<SaveHandler | null>(null);
  const sessions = shallowReactive(new Set<SaveSessionHandle>());
  const lockedParticipants = shallowReactive(new Map<string, Set<SaveSessionHandle>>());
  const preparingParticipants = new Set<SaveSessionHandle>();
  const editTargets = computed(() => [...sessions].flatMap((handle) => handle.editing?.targets.value ?? []));
  let transitionSequence = 0;

  function registerSaveSession(handle: SaveSessionHandle) {
    sessions.add(handle);
    return () => {
      sessions.delete(handle);
      for (const handles of lockedParticipants.values()) handles.delete(handle);
    };
  }
  function holdParticipants(handles: SaveSessionHandle[], requestId: string) {
    const releases = handles.flatMap((handle) => (handle.editing?.hold ? [handle.editing.hold(requestId)] : []));
    lockedParticipants.set(requestId, new Set(handles));
    return () => {
      lockedParticipants.delete(requestId);
      releases.forEach((release) => release());
    };
  }
  function isEditTargetLocked(key: string | null): boolean {
    return (
      key !== null &&
      [...lockedParticipants.values()].some((handles) =>
        [...handles].some((handle) => sessions.has(handle) && handle.targetKey.value === key),
      )
    );
  }
  function participantsForTargets(targets: readonly EditWriteTarget[]) {
    return [...sessions]
      .filter((handle) => handle.editing?.targets.value.some((own) => targets.some((target) => editTargetsOverlap(own, target))))
      .sort((left, right) => JSON.stringify(left.editing!.targets.value).localeCompare(JSON.stringify(right.editing!.targets.value)));
  }
  function isSessionRegistered(handle: SaveSessionHandle) {
    return sessions.has(handle);
  }
  async function savePreparedParticipant(handle: SaveSessionHandle) {
    preparingParticipants.add(handle);
    try {
      return await handle.editing!.save();
    } finally {
      preparingParticipants.delete(handle);
    }
  }
  function isPreparingParticipant(key: string | null) {
    return [...preparingParticipants].some((handle) => handle.targetKey.value === key);
  }
  function hasPendingSave(modRoot?: string | null) {
    return [...sessions].some(
      (handle) => (handle.saving.value || handle.pendingSynchronization?.value) && (modRoot == null || handle.modRoot.value === modRoot),
    );
  }
  function waitForSaves(modRoot?: string | null, targetKey?: string | null): Promise<boolean> | undefined {
    const pending = [...sessions].filter(
      (handle) =>
        (handle.saving.value || handle.pendingSynchronization?.value) &&
        (modRoot == null || handle.modRoot.value === modRoot) &&
        (targetKey == null || handle.targetKey.value === targetKey),
    );
    if (pending.length === 0) return;
    return Promise.all(pending.map((handle) => handle.waitForSave())).then((outcomes) => outcomes.every(Boolean));
  }
  function beginTransition() {
    return ++transitionSequence;
  }
  function isTransitionCurrent(sequence: number) {
    return sequence === transitionSequence;
  }

  function registerActiveSaveHandler(handler: SaveHandler): void {
    activeHandler.value = handler;
  }

  function unregisterActiveSaveHandler(handler: SaveHandler): void {
    if (activeHandler.value === handler) {
      activeHandler.value = null;
    }
  }

  function dispatchSaveCommand(): boolean {
    if (!activeHandler.value) return false;
    if (![...sessions].some((handle) => handle.saving.value)) void activeHandler.value();
    return true;
  }

  return {
    editTargets,
    holdParticipants,
    isEditTargetLocked,
    participantsForTargets,
    isSessionRegistered,
    savePreparedParticipant,
    isPreparingParticipant,
    registerActiveSaveHandler,
    unregisterActiveSaveHandler,
    dispatchSaveCommand,
    registerSaveSession,
    hasPendingSave,
    waitForSaves,
    beginTransition,
    isTransitionCurrent,
  };
});
