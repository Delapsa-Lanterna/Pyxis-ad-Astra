import { computed, ref, shallowReactive, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { stableStringify } from '@/shared/lib/stable-compare';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { EditWriteTarget } from '@/shared/types';
import { editTargetsOverlap } from '@/domain/edit-session';
import { debugLog } from '@/shared/runtime/app-log-queue';

type SaveHandler = () => void | Promise<void>;

export interface SaveSessionHandle {
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
  save: () => Promise<DocumentSaveResult>;
  hold?: (requestId: string) => () => void;
}

interface SaveRequest {
  handle: SaveSessionHandle;
  running: boolean;
  run: () => Promise<DocumentSaveResult>;
  modRoot: string | null;
  promise: Promise<DocumentSaveResult>;
  resolve: (result: DocumentSaveResult) => void;
  reject: (error: unknown) => void;
}

export const useSaveCommandStore = defineStore('save-command', () => {
  const activeHandler = ref<SaveHandler | null>(null);
  const sessions = shallowReactive(new Set<SaveSessionHandle>());
  const lockedParticipants = shallowReactive(new Map<string, Set<SaveSessionHandle>>());
  const preparingParticipants = new Set<SaveSessionHandle>();
  const editTargets = computed(() => [...sessions].flatMap((handle) => handle.editing?.targets.value ?? []));
  const requests = shallowReactive(new Map<SaveSessionHandle, SaveRequest>());
  const queue: SaveRequest[] = [];
  let draining = false;
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
      const pending = requests.get(handle);
      if (pending && queue.includes(pending)) {
        queue.splice(queue.indexOf(pending), 1);
        requests.delete(handle);
        pending.resolve({ status: 'cancelled' });
      }
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
  async function savePreparedParticipant(handle: SaveSessionHandle, parentKey?: string) {
    preparingParticipants.add(handle);
    try {
      const request = requests.get(handle) ?? createRequest(handle);
      if ([...requests.values()].some((parent) => parent.running && parent.handle.targetKey.value === parentKey)) void executeSave(request);
      else if (!request.running) {
        if (!queue.includes(request)) queue.push(request);
        void drainQueue();
      }
      return await request.promise;
    } finally {
      preparingParticipants.delete(handle);
    }
  }
  function createRequest(handle: SaveSessionHandle, run = handle.editing!.save): SaveRequest {
    let resolve!: SaveRequest['resolve'];
    let reject!: SaveRequest['reject'];
    const promise = new Promise<DocumentSaveResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const request = { handle, running: false, run, modRoot: handle.modRoot.value, promise, resolve, reject };
    requests.set(handle, request);
    return request;
  }
  function requestSave(handle: SaveSessionHandle, run?: () => Promise<DocumentSaveResult>): Promise<DocumentSaveResult> {
    const pending = requests.get(handle);
    if (pending) return pending.promise;
    debugLog('save.queued', () => ({ target: handle.targetKey.value ?? '', modRoot: handle.modRoot.value ?? '' }));
    const request = createRequest(handle, run);
    queue.push(request);
    void drainQueue();
    return request.promise;
  }
  async function executeSave(request: SaveRequest): Promise<void> {
    if (request.running) return;
    request.running = true;
    debugLog('save.started', () => ({ target: request.handle.targetKey.value ?? '', modRoot: request.modRoot ?? '' }));
    const index = queue.indexOf(request);
    if (index !== -1) queue.splice(index, 1);
    try {
      const result = sessions.has(request.handle) ? await request.run() : { status: 'cancelled' as const };
      request.resolve(result);
      debugLog(result.status === 'cancelled' ? 'save.cancelled' : 'save.completed', () => ({
        target: request.handle.targetKey.value ?? '',
        modRoot: request.modRoot ?? '',
        status: result.status,
      }));
    } catch (error) {
      request.reject(error);
      debugLog('save.failed', () => ({ target: request.handle.targetKey.value ?? '', modRoot: request.modRoot ?? '' }));
      for (const pending of queue.splice(0))
        if (pending.modRoot === request.modRoot) {
          requests.delete(pending.handle);
          pending.resolve({ status: 'cancelled' });
        } else queue.push(pending);
    } finally {
      requests.delete(request.handle);
    }
  }
  async function drainQueue() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const request = queue.shift()!;
        if (requests.get(request.handle) !== request) continue;
        await executeSave(request);
      }
    } finally {
      draining = false;
    }
  }
  function isSaveQueued(handle: SaveSessionHandle) {
    return requests.has(handle);
  }
  function waitForSession(handle: SaveSessionHandle) {
    const request = requests.get(handle);
    return request
      ? request.promise.then(
          (result) => result.status !== 'cancelled',
          () => false,
        )
      : handle.waitForSave().catch(() => false);
  }
  function isPreparingParticipant(key: string | null) {
    return [...preparingParticipants].some((handle) => handle.targetKey.value === key);
  }
  function hasPendingSave(modRoot?: string | null) {
    return [...sessions].some(
      (handle) =>
        (requests.has(handle) || handle.saving.value || handle.pendingSynchronization?.value) &&
        (modRoot == null || handle.modRoot.value === modRoot),
    );
  }
  function waitForSaves(modRoot?: string | null, targetKey?: string | null): Promise<boolean> | undefined {
    const pending = [...sessions].filter(
      (handle) =>
        (requests.has(handle) || handle.saving.value || handle.pendingSynchronization?.value) &&
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
