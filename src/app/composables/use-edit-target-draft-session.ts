import type { SaveCommandRequest, SaveOperation } from '@/shared/runtime/command.runtime';
import { computed, ref, shallowRef, type Ref } from 'vue';
import { createFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import { useDraftSession, type DraftSessionOptions } from '@/app/composables/use-draft-session';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { errorCodeOf } from '@/shared/lib/errors';
import { createReadTicketOwner, isReadInvalidated } from '@/shared/runtime/read-request';
import type { EditContext, FileVersion } from '@/shared/types';
import { retainLaterDraft } from '@/domain/project/save-edits';

type MaybePromise<T> = T | Promise<T>;
export type SnapshotAcceptance = 'baseline' | 'pending' | 'obsolete';

export interface EditTargetSnapshot<TValue, TTarget = unknown, TMeta = unknown> {
  target: TTarget;
  value: TValue;
  baseVersions: FileVersion[];
  meta: TMeta;

  requestId?: string;
}

export interface EditTargetDraftSessionOptions<TValue, TTarget, TMeta = unknown> extends DraftSessionOptions<TValue> {
  emptyValue: TValue;
  load: (target: TTarget, signal?: AbortSignal) => MaybePromise<EditTargetSnapshot<TValue, TTarget, TMeta>>;
  save?: (
    target: TTarget,
    draft: TValue,
    baseVersions: FileVersion[],
    original: TValue,
    request?: SaveCommandRequest,
  ) => MaybePromise<EditTargetSnapshot<TValue, TTarget, TMeta> | void>;
  targetKey: (target: TTarget) => string;
  mapSavedDraft?: (
    draft: TValue,
    before: EditTargetSnapshot<TValue, TTarget, TMeta>,
    after: EditTargetSnapshot<TValue, TTarget, TMeta>,
    submitted: TValue,
  ) => TValue;
  acceptSaved?: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => MaybePromise<void>;
  beginSave?: (
    write: (request?: SaveCommandRequest) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | void>,
    accept: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => import('@/stores/project-sync.store').SaveTask[],
  ) => SaveOperation<EditTargetSnapshot<TValue, TTarget, TMeta> | void>;
  savedContent?: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => EditTargetSnapshot<TValue, TTarget, TMeta>;
  confirmSave?: (target: TTarget, value: TValue) => MaybePromise<boolean>;
  afterSaved?: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => void;
  mapSaveError?: (error: unknown) => unknown;
}

export interface EditTargetDraftSession<TValue, TTarget, TMeta = unknown> {
  currentTarget: Ref<TTarget | null>;
  currentTargetKey: Ref<string | null>;
  baselineSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
  pendingSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
  context: Readonly<Ref<EditContext | null>>;
  dirty: Readonly<Ref<boolean>>;
  draftValue: Ref<TValue>;
  externalUpdateNotice: Readonly<Ref<string>>;
  hasPendingExternalValue: Readonly<Ref<boolean>>;
  pendingExternalValue: Readonly<Ref<TValue | null>>;
  loading: Ref<boolean>;
  ready: Readonly<Ref<boolean>>;
  saving: Ref<boolean>;
  inputs: FieldInputs;
  applyExternalForTarget: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>, fromSave?: boolean) => SnapshotAcceptance;
  adoptIdentity: (
    expected: TTarget,
    snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>,
    mapDraft: (draft: TValue) => TValue,
    handoff?: 'external' | 'save' | 'identity',
  ) => boolean;
  loadBaseForTarget: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => void;
  prepareClose: () => () => Promise<void>;
  clearTarget: () => void;
  cancelRead: () => void;
  dispose: () => void;
  loadPendingExternal: () => void;
  loadTarget: (target: TTarget) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  refreshTarget: (target: TTarget, fromSave?: boolean) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  resetDraft: () => void;
  saveDraft: (
    write?: EditTargetDraftSessionOptions<TValue, TTarget, TMeta>['save'],
    preserveDraft?: boolean,
  ) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  waitForSave: () => Promise<boolean>;
  setDraft: (value: TValue) => void;
  isTargetCurrent: (target: TTarget) => boolean;
  acceptsSaveDelivery: (target: TTarget, requestId?: string) => boolean;
}

export function useEditTargetDraftSession<TValue, TTarget, TMeta = unknown>(
  options: EditTargetDraftSessionOptions<TValue, TTarget, TMeta>,
): EditTargetDraftSession<TValue, TTarget, TMeta> {
  type Snapshot = EditTargetSnapshot<TValue, TTarget, TMeta>;
  const clone = options.clone ?? deepClone;
  const equals = options.equals ?? stableDeepEqual;
  const copy = ({ value, ...metadata }: Snapshot): Snapshot => ({ ...deepClone(metadata), value: clone(value) });
  const session = useDraftSession<Snapshot | null>(null, {
    clone: (snapshot) => (snapshot === null ? null : copy(snapshot)),
    equals: (left, right) => (left === null || right === null ? left === right : equals(left.value, right.value)),
  });
  const currentTarget = shallowRef<TTarget | null>(null) as Ref<TTarget | null>;
  const currentTargetKey = ref<string | null>(null);
  const inputs = createFieldInputs(currentTargetKey);
  const context = shallowRef<EditContext | null>(null);
  let submittedRequestId: string | null = null;
  const reads = createReadTicketOwner();
  const loading = ref(false);
  const saving = ref(false);
  const baselineSnapshot = computed(() => session.baseValue.value);
  const pendingSnapshot = computed(() => session.pendingExternalValue.value);
  const ready = computed(() => baselineSnapshot.value !== null && sameTarget(baselineSnapshot.value.target));
  let pendingDraftBeforeLoad: TValue | null = null;
  const dirty = computed(() => session.dirty.value || inputs.dirty.value || pendingDraftBeforeLoad !== null);
  let disposed = false;
  let lifetime = 0;
  let baselineGeneration = 0;
  let pendingSave: Promise<Snapshot | null> | null = null;
  let refreshQueued = false;
  let prepared = false;
  function prepareClose() {
    prepared = true;
    refreshQueued ||= loading.value;
    revokeReads();
    return async () => {
      prepared = false;
      if (refreshQueued && currentTarget.value && !disposed) {
        refreshQueued = false;
        await refreshTarget(currentTarget.value);
      }
    };
  }

  function revokeReads() {
    reads.revoke('consumer');
    loading.value = false;
  }

  function publishContext(handoff: EditContext['handoff']) {
    context.value = { targetKey: currentTargetKey.value!, baselineGeneration: ++baselineGeneration, handoff };
  }
  function sameTarget(target: TTarget) {
    return currentTargetKey.value === options.targetKey(target);
  }
  function setDraft(value: TValue) {
    const baseline = baselineSnapshot.value;
    if (!baseline) {
      pendingDraftBeforeLoad = clone(value);
      return;
    }
    pendingDraftBeforeLoad = null;
    revokeReads();
    session.setDraft({ ...baseline, value });
  }
  const draftValue = computed({
    get: () => session.draftValue.value?.value ?? options.emptyValue,
    set: setDraft,
  });

  function loadBaseForTarget(snapshot: Snapshot, revoke = true) {
    if (revoke) revokeReads();
    currentTarget.value = snapshot.target;
    currentTargetKey.value = options.targetKey(snapshot.target);
    session.loadBase(snapshot);
    if (pendingDraftBeforeLoad !== null) {
      session.setDraft({ ...snapshot, value: pendingDraftBeforeLoad });
      pendingDraftBeforeLoad = null;
    }
    inputs.cancel();
    publishContext('load');
  }

  function adoptIdentity(
    expected: TTarget,
    snapshot: Snapshot,
    mapDraft: (draft: TValue) => TValue,
    handoff: 'external' | 'save' | 'identity' = 'external',
  ): boolean {
    if (disposed || !sameTarget(expected)) return false;
    const draft = mapDraft(clone(draftValue.value));
    revokeReads();
    currentTarget.value = snapshot.target;
    currentTargetKey.value = options.targetKey(snapshot.target);
    session.commitSaved(snapshot, { ...snapshot, value: draft });
    publishContext(handoff);
    return true;
  }

  function applyExternalForTarget(snapshot: Snapshot, fromSaveRefresh = false): SnapshotAcceptance {
    if (disposed || !sameTarget(snapshot.target)) return 'obsolete';
    if ((saving.value || prepared) && !fromSaveRefresh) {
      refreshQueued = true;
      return 'obsolete';
    }
    const baseline = baselineSnapshot.value;
    const sameBaseline =
      baseline !== null && equals(baseline.value, snapshot.value) && stableDeepEqual(baseline.baseVersions, snapshot.baseVersions);
    revokeReads();
    if (sameBaseline) {
      session.commitSavedBaseline(snapshot, true);
      return 'baseline';
    }
    if (dirty.value) {
      session.applyExternal(snapshot, true);
      return 'pending';
    }
    session.loadBase(snapshot);
    inputs.cancel();
    publishContext('external');
    return 'baseline';
  }

  async function readTarget(target: TTarget, mode: 'load' | 'external', fromSaveRefresh = false): Promise<Snapshot | null> {
    if (prepared) {
      refreshQueued = true;
      return null;
    }
    const key = options.targetKey(target);
    if (mode === 'load' && key !== currentTargetKey.value) {
      revokeReads();
      session.clear(null);
      pendingDraftBeforeLoad = null;
      inputs.cancel();
      currentTarget.value = target;
      currentTargetKey.value = key;
    }
    const identity = { targetKey: key, lifetime };
    loading.value = true;
    let result: Snapshot | null = null;
    await reads.consume('target', identity, (signal) => options.load(target, signal), {
      ready: (snapshot) => {
        if (mode === 'load') loadBaseForTarget(snapshot, false);
        else if (applyExternalForTarget(snapshot, fromSaveRefresh) !== 'baseline') return;
        result = copy(snapshot);
      },
      settled: () => {
        loading.value = false;
      },
    });
    return result;
  }
  function loadTarget(target: TTarget) {
    return readTarget(target, 'load');
  }
  function refreshTarget(target: TTarget, fromSave = false): Promise<Snapshot | null> {
    if (saving.value && !fromSave) {
      refreshQueued = true;
      return pendingSave!.then(
        () => baselineSnapshot.value,
        () => null,
      );
    }
    return readTarget(target, 'external', fromSave);
  }

  function saveDraft(write = options.save, preserveDraft = false): Promise<Snapshot | null> {
    if (pendingSave) return pendingSave;
    if (!write || !ready.value || disposed) return Promise.resolve(null);
    saving.value = true;
    const life = lifetime;
    let submitted = clone(draftValue.value);
    const committed = inputs.commit(undefined, true, () => {
      submitted = clone(draftValue.value);
    });
    const versions = deepClone(baselineSnapshot.value!.baseVersions);
    const original = clone(baselineSnapshot.value!.value);
    const capturedTarget = deepClone(currentTarget.value!);
    const operation = (async () => {
      if (committed && !(await committed)) return null;
      if (options.confirmSave && !(await options.confirmSave(capturedTarget, submitted))) return null;
      return submit(capturedTarget, options.targetKey(capturedTarget), life, write, preserveDraft, submitted, versions, original);
    })();
    const task = operation
      .then((snapshot) => {
        if (!snapshot) refreshQueued = false;
        return snapshot;
      })
      .catch((error: unknown) => {
        refreshQueued = false;
        if (isReadInvalidated(error) || errorCodeOf(error) === 'write.cancelled') return null;
        throw options.mapSaveError && !disposed && life === lifetime ? options.mapSaveError(error) : error;
      })
      .finally(() => {
        saving.value = false;
        pendingSave = null;
      });
    pendingSave = task;
    return task;
  }

  async function submit(
    target: TTarget,
    key: string | null,
    life: number,
    write: NonNullable<typeof options.save>,
    preserveDraft: boolean,
    submitted: TValue,
    versions: FileVersion[],
    original: TValue,
  ): Promise<Snapshot | null> {
    if (disposed || life !== lifetime || key !== currentTargetKey.value) return null;
    revokeReads();
    const acceptContent = (result: Snapshot) => {
      revokeReads();
      if (
        !disposed &&
        life === lifetime &&
        (key === currentTargetKey.value || options.targetKey(result.target) === currentTargetKey.value)
      ) {
        const content = options.savedContent?.(result) ?? result;
        if (result.requestId) content.requestId = result.requestId;
        const preserve = preserveDraft || !equals(draftValue.value, submitted) || inputs.dirty.value;
        if (preserve && options.mapSavedDraft)
          session.commitSaved(content, {
            ...content,
            value: options.mapSavedDraft(draftValue.value, baselineSnapshot.value!, result, submitted),
          });
        else if (preserveDraft) session.commitSavedBaseline(content);
        else if (preserve) session.commitSaved(content, { ...content, value: retainLaterDraft(draftValue.value, submitted, result.value) });
        else session.commitSaved(content);
        currentTarget.value = result.target;
        currentTargetKey.value = options.targetKey(result.target);
        publishContext('save');
      }
    };
    const tasks = (snapshot: Snapshot) => {
      return [
        () => acceptContent(snapshot),
        async () => options.acceptSaved?.(copy(snapshot)),
        async () => {
          if (refreshQueued && !disposed && life === lifetime) {
            await readTarget(currentTarget.value!, 'external', true);
            refreshQueued = false;
          }
        },
      ];
    };
    const operation = options.beginSave!((request) => Promise.resolve(write(target, submitted, versions, original, request)), tasks);
    submittedRequestId = operation.id;
    return finishSave(operation.result);
  }

  async function finishSave(result: Promise<Snapshot | void>): Promise<Snapshot | null> {
    const snapshot = await result;
    if (snapshot) options.afterSaved?.(copy(snapshot));
    return snapshot ? copy(snapshot) : null;
  }

  function loadPendingExternal() {
    const snapshot = pendingSnapshot.value;
    if (!snapshot) return;
    revokeReads();
    session.loadPendingExternal();
    currentTarget.value = snapshot.target;
    currentTargetKey.value = options.targetKey(snapshot.target);
    inputs.cancel();
    publishContext('external');
  }
  function resetDraft() {
    revokeReads();
    pendingDraftBeforeLoad = null;
    session.resetDraft();
    inputs.cancel();
    publishContext('reset');
  }
  function clearTarget() {
    submittedRequestId = null;
    pendingDraftBeforeLoad = null;
    lifetime++;
    revokeReads();
    currentTarget.value = null;
    currentTargetKey.value = null;
    context.value = null;
    loading.value = false;
    session.clear(null);
    inputs.cancel();
  }
  function dispose() {
    disposed = true;
    clearTarget();
    inputs.release();
  }
  return {
    prepareClose,
    currentTarget,
    currentTargetKey,
    baselineSnapshot,
    pendingSnapshot,
    context,
    dirty,
    draftValue,
    loading,
    ready,
    saving,
    inputs,
    hasPendingExternalValue: computed(() => pendingSnapshot.value !== null),
    pendingExternalValue: computed(() => pendingSnapshot.value?.value ?? null),
    externalUpdateNotice: computed(() =>
      pendingSnapshot.value ? (options.externalNotice ?? '外部版本已更新，当前未保存草稿已保留。') : '',
    ),
    applyExternalForTarget,
    adoptIdentity,
    loadBaseForTarget,
    clearTarget,
    cancelRead: revokeReads,
    dispose,
    loadPendingExternal,
    loadTarget,
    refreshTarget,
    resetDraft,
    saveDraft,
    setDraft,
    isTargetCurrent: sameTarget,
    acceptsSaveDelivery: (target, requestId) =>
      !disposed &&
      sameTarget(target) &&
      !(requestId && (submittedRequestId === requestId || baselineSnapshot.value?.requestId === requestId)),
    waitForSave: () =>
      pendingSave
        ? pendingSave.then(
            (snapshot) => snapshot !== null,
            () => false,
          )
        : Promise.resolve(true),
  };
}
