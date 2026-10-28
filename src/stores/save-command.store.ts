import { computed, ref, shallowReactive, watch, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { stableStringify } from '@/shared/lib/stable-compare';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { EditWriteTarget } from '@/shared/types';
import { editTargetsOverlap } from '@/domain/edit-session';
import { debugLog } from '@/shared/runtime/app-log-queue';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { normalizeFsPath } from '@/shared/lib/paths';

type SaveHandler = () => void | Promise<void>;

export interface SaveSessionHandle {
  targetKey: Readonly<Ref<string | null>>;
  modRoot: Readonly<Ref<string | null>>;
  saving: Readonly<Ref<boolean>>;
  waitForSave: () => Promise<boolean>;
  editing?: EditParticipant;
}

export interface EditParticipant {
  targets: Readonly<Ref<EditWriteTarget[]>>;
  label: string;
  dirty: Readonly<Ref<boolean>>;
  draftSession: { draftValue: Readonly<Ref<unknown>>; inputs: FieldInputs; prepareClose?: () => () => Promise<void> };
  save: () => Promise<DocumentSaveResult>;
  hold?: (requestId: string) => () => void;
}

export const useSaveCommandStore = defineStore('save-command', () => {
  const activeHandler = ref<SaveHandler | null>(null);
  const sessions = shallowReactive(new Set<SaveSessionHandle>());
  const editTargets = computed(() => [...sessions].flatMap((handle) => handle.editing?.targets.value ?? []));
  const requests = shallowReactive(new Map<SaveSessionHandle, Promise<DocumentSaveResult>>());
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
    };
  }
  function participantsForTargets(targets: readonly EditWriteTarget[]) {
    return [...sessions]
      .filter((handle) => handle.editing?.targets.value.some((own) => targets.some((target) => editTargetsOverlap(own, target))))
      .sort((left, right) => JSON.stringify(left.editing!.targets.value).localeCompare(JSON.stringify(right.editing!.targets.value)));
  }
  function requestSave(handle: SaveSessionHandle, run = handle.editing!.save): Promise<DocumentSaveResult> {
    const pending = requests.get(handle);
    if (pending) return pending;
    if (useProjectSyncStore().isWaiting(handle.modRoot.value)) return Promise.resolve({ status: 'cancelled' });
    const fields = () => ({ target: handle.targetKey.value ?? '', modRoot: handle.modRoot.value ?? '' });
    debugLog('save.queued', fields);
    debugLog('save.started', fields);
    const result = run()
      .then(
        (value) => {
          debugLog(value.status === 'cancelled' ? 'save.cancelled' : 'save.completed', () => ({ ...fields(), status: value.status }));
          return value;
        },
        (error) => {
          debugLog('save.failed', fields);
          throw error;
        },
      )
      .finally(() => requests.delete(handle));
    requests.set(handle, result);
    return result;
  }
  function isSaveQueued(handle: SaveSessionHandle) {
    return requests.has(handle);
  }
  function waitForSession(handle: SaveSessionHandle) {
    const sync = useProjectSyncStore();
    const blocked = () => sync.blocked.some((work) => normalizeFsPath(work.modRoot) === normalizeFsPath(handle.modRoot.value!));
    if (blocked()) return Promise.resolve(false);
    const request = requests.get(handle);
    const waiting = request
      ? request.then(
          (result) => result.status !== 'cancelled',
          () => false,
        )
      : handle.waitForSave().catch(() => false);
    return new Promise<boolean>((resolve) => {
      const stop = watch(blocked, (value) => {
        if (value) finish(false);
      });
      function finish(accepted: boolean) {
        stop();
        resolve(accepted);
      }
      void waiting.then(finish);
    });
  }
  function hasPendingSave(modRoot?: string | null) {
    return [...sessions].some(
      (handle) => (requests.has(handle) || handle.saving.value) && (modRoot == null || handle.modRoot.value === modRoot),
    );
  }
  function waitForSaves(modRoot?: string | null, targetKey?: string | null): Promise<boolean> | undefined {
    const pending = [...sessions].filter(
      (handle) =>
        (requests.has(handle) || handle.saving.value) &&
        (modRoot == null || handle.modRoot.value === modRoot) &&
        (targetKey == null || handle.targetKey.value === targetKey),
    );
    if (pending.length === 0) return;
    return Promise.all(pending.map(waitForSession)).then(
      (outcomes) => outcomes.every(Boolean) && (waitForSaves(modRoot, targetKey) ?? true),
    );
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
    void activeHandler.value();
    return true;
  }

  return {
    requestSave,
    isSaveQueued,
    waitForSession,
    closePreparations,
    closePrepared,
    trackCloseAction,
    settleCloseActions,
    captureCloseState,
    editTargets,
    participantsForTargets,
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
