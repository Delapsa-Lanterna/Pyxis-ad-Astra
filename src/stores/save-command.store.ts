import { ref, shallowReactive, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { computed } from 'vue';
import { stableStringify } from '@/shared/lib/stable-compare';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import type { EditWriteTarget } from '@/shared/types';
import { editTargetsOverlap } from '@/domain/edit-session';

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
  draftSession: { draftValue: Readonly<Ref<unknown>>; inputs: FieldInputs; prepareClose?: () => () => Promise<void> };
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
  const closePrepared = ref(false);
  const closePreparations = computed(() =>
    [...sessions].flatMap((handle) => (handle.editing?.draftSession.prepareClose ? [handle.editing.draftSession.prepareClose] : [])),
  );
  const closeActions = new Set<Promise<unknown>>();
  function trackCloseAction<T>(action: Promise<T>): Promise<T> {
    closeActions.add(action);
    void action.finally(() => closeActions.delete(action)).catch(() => {});
    return action;
  }
  async function settleCloseActions() {
    while (closeActions.size) await Promise.all([...closeActions]);
  }

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
  function captureCloseState() {
    const capture = () =>
      stableStringify(
        [...sessions].map((handle) => [handle.targetKey.value, handle.editing?.draftSession.draftValue.value, handle.editing?.dirty.value]),
      );
    const handles = [...sessions];
    const snapshot = capture();
    const accepts = [...sessions].flatMap((handle) => (handle.editing ? [handle.editing.draftSession.inputs.captureContext()] : []));
    return () => handles.every((handle) => sessions.has(handle)) && snapshot === capture() && accepts.every((accept) => accept());
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
    closePreparations,
    closePrepared,
    trackCloseAction,
    settleCloseActions,
    captureCloseState,
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
