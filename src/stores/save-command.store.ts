import { computed, ref, shallowReactive, watch, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { stableStringify } from '@/shared/lib/stable-compare';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { EditWriteTarget } from '@/shared/types';
import { editTargetsOverlap } from '@/domain/edit-session';
import { logIdentity } from '@/shared/lib/log-fields';
import { beginDebug } from '@/shared/runtime/app-log-queue';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { normalizeFsPath } from '@/shared/lib/paths';

type SaveHandler = () => void | Promise<void>;

export interface SaveParticipant {
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
  const participants = shallowReactive(new Set<SaveParticipant>());
  const participantIds = new WeakMap<SaveParticipant, number>();
  let participantSequence = 0;
  const editTargets = computed(() => [...participants].flatMap((participant) => participant.editing?.targets.value ?? []));
  const requests = shallowReactive(new Map<SaveParticipant, Promise<DocumentSaveResult>>());
  let transitionSequence = 0;
  const closePrepared = ref(false);
  const closePreparations = computed(() =>
    [...participants].flatMap((participant) =>
      participant.editing?.draftSession.prepareClose ? [participant.editing.draftSession.prepareClose] : [],
    ),
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

  function registerSaveParticipant(participant: SaveParticipant) {
    participantIds.set(participant, ++participantSequence);
    participants.add(participant);
    return () => {
      participants.delete(participant);
    };
  }
  function participantsForSession(sessionId: string, modRoot: string) {
    return [...participants]
      .filter((participant) =>
        participant.editing?.targets.value.some(
          (target) => target.sessionId === sessionId && normalizeFsPath(target.modRoot) === normalizeFsPath(modRoot),
        ),
      )
      .map((participant) => ({ id: participantIds.get(participant)!, participant }))
      .sort((left, right) => String(left.participant.targetKey.value).localeCompare(String(right.participant.targetKey.value)));
  }
  function participantsForTargets(targets: readonly EditWriteTarget[]) {
    return [...participants]
      .filter((participant) => participant.editing?.targets.value.some((own) => targets.some((target) => editTargetsOverlap(own, target))))
      .sort((left, right) => JSON.stringify(left.editing!.targets.value).localeCompare(JSON.stringify(right.editing!.targets.value)));
  }
  function requestSave(participant: SaveParticipant, run = participant.editing!.save): Promise<DocumentSaveResult> {
    const pending = requests.get(participant);
    if (pending) return pending;
    if (useProjectSyncStore().isWaiting(participant.modRoot.value)) return Promise.resolve({ status: 'cancelled' });
    const finish = beginDebug('save', () => ({
      target: participant.targetKey.value ?? '',
      modRoot: participant.modRoot.value ?? '',
      ...logIdentity(participant.editing?.targets.value),
    }));
    const result = run()
      .then(
        (value) => {
          finish?.(
            value.status === 'cancelled' ? 'cancelled' : 'completed',
            value.status === 'saved' ? { status: value.status, requestId: value.receipt.requestId } : value,
          );
          return value;
        },
        (error) => {
          finish?.('failed', undefined, error);
          throw error;
        },
      )
      .finally(() => requests.delete(participant));
    requests.set(participant, result);
    return result;
  }
  function isSaveQueued(participant: SaveParticipant) {
    return requests.has(participant);
  }
  function waitForParticipant(participant: SaveParticipant) {
    const sync = useProjectSyncStore();
    const blocked = () => sync.blocked.some((work) => normalizeFsPath(work.modRoot) === normalizeFsPath(participant.modRoot.value!));
    if (blocked()) return Promise.resolve(false);
    const request = requests.get(participant);
    const waiting = request
      ? request.then(
          (result) => result.status !== 'cancelled',
          () => false,
        )
      : participant.waitForSave().catch(() => false);
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
    return [...participants].some(
      (participant) =>
        (requests.has(participant) || participant.saving.value) && (modRoot == null || participant.modRoot.value === modRoot),
    );
  }
  function waitForSaves(modRoot?: string | null, targetKey?: string | null): Promise<boolean> | undefined {
    const pending = [...participants].filter(
      (participant) =>
        (requests.has(participant) || participant.saving.value) &&
        (modRoot == null || participant.modRoot.value === modRoot) &&
        (targetKey == null || participant.targetKey.value === targetKey),
    );
    if (pending.length === 0) return;
    return Promise.all(pending.map(waitForParticipant)).then(
      (outcomes) => outcomes.every(Boolean) && (waitForSaves(modRoot, targetKey) ?? true),
    );
  }
  function captureCloseState() {
    const capture = () =>
      stableStringify(
        [...participants].map((participant) => [
          participant.targetKey.value,
          participant.editing?.draftSession.draftValue.value,
          participant.editing?.dirty.value,
        ]),
      );
    const capturedParticipants = [...participants];
    const snapshot = capture();
    const accepts = [...participants].flatMap((participant) =>
      participant.editing ? [participant.editing.draftSession.inputs.captureContext()] : [],
    );
    return () =>
      capturedParticipants.every((participant) => participants.has(participant)) &&
      snapshot === capture() &&
      accepts.every((accept) => accept());
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
    waitForParticipant,
    closePreparations,
    closePrepared,
    trackCloseAction,
    settleCloseActions,
    captureCloseState,
    editTargets,
    participantsForTargets,
    participantsForSession,
    registerActiveSaveHandler,
    unregisterActiveSaveHandler,
    dispatchSaveCommand,
    registerSaveParticipant,
    hasPendingSave,
    waitForSaves,
    beginTransition,
    isTransitionCurrent,
  };
});
