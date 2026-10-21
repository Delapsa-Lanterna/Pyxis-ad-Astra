import { WINDOW_EVENTS } from '@/windows/window.events';
import { emitWindowEvent, listenWindowEvent } from '@/windows/tauri.events';
import { currentWindowLabel } from '@/windows/current.window';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { releaseNativeWindowTargets, queryEditTargetOwners, reserveEditTargets, focusEditTargetOwner } from '@/services/window.service';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import { deepClone } from '@/shared/lib/starsector';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { editTargetsOverlap } from '@/domain/edit-session';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import type {
  AppFeedback,
  EntityEditInfo,
  EntityEditTarget,
  WriteResult,
  EditWriteTarget,
  EditHandoffRequest,
  EditHandoffReply,
  EditHandoffRelease,
} from '@/shared/types';

export async function createEntitySavePreparation(feedback: AppFeedback, targetKey: () => string | null) {
  let disposed = false;
  const lifecycle = new AbortController();
  let release: (() => Promise<void>) | null = null;
  return {
    finish: async () => {
      await release?.();
      release = null;
    },
    dispose: () => {
      disposed = true;
      lifecycle.abort();
      void release?.().catch((error) => recordWindowEventHandlerError(error, WINDOW_EVENTS.editTargetRelease));
      release = null;
    },
    withPreparation: async <T>(
      sessionId: string,
      modRoot: string,
      source: EntityEditTarget,
      submit: (info: EntityEditInfo | null, receipt: WriteResult<unknown> | null) => Promise<T | null>,
    ) => {
      const original = cloneQuerySnapshot<EntityEditInfo>(await querySessionEntityEditTarget(sessionId, source.kind, source.id));
      const targets = original.baseVersions.map((version) => ({ sessionId, modRoot, path: version.path }));
      targets.push({ sessionId, modRoot, path: source.write.path });
      if (useSaveCommandStore().isPreparingParticipant(targetKey())) return submit(original, null);
      return withEditTargetHandoff(
        targets,
        feedback,
        async (receipts) => {
          if (disposed) return null;
          const receipt = receipts.findLast((result) =>
            result.identityChanges.some((change) => change.before.kind === source.kind && change.before.id === source.id),
          );
          const changed = receipt?.identityChanges.find(
            (change) => change.before.kind === source.kind && change.before.id === source.id,
          )?.after;
          const info = cloneQuerySnapshot<EntityEditInfo>(
            await querySessionEntityEditTarget(sessionId, source.kind, changed?.id ?? source.id),
          );
          if (disposed) return null;
          return submit(info, receipt ?? null);
        },
        targetKey() ?? undefined,
        (cleanup) => (release = cleanup),
        lifecycle.signal,
      );
    },
  };
}

interface PreparedParticipants {
  receipts: WriteResult<unknown>[];
  release: () => void;
  isCurrent: () => boolean;
}

const activeHandoffs = new Map<string, { promise: Promise<unknown>; signal?: AbortSignal; targets: EditWriteTarget[] }>();

export function withEditTargetHandoff<T>(
  targets: EditWriteTarget[],
  feedback: AppFeedback,
  action: (receipts: WriteResult<unknown>[]) => Promise<T>,
  excludeTargetKey?: string,
  deferRelease?: (release: () => Promise<void>) => void,
  signal?: AbortSignal,
): Promise<T | null> {
  const key = JSON.stringify([targets, excludeTargetKey]);
  const active = activeHandoffs.get(key);
  if (active && !active.signal?.aborted) return active.promise as Promise<T | null>;
  const operation = runHandoff(targets, feedback, action, excludeTargetKey, deferRelease, signal).finally(() => {
    if (activeHandoffs.get(key)?.promise === operation) activeHandoffs.delete(key);
  });
  activeHandoffs.set(key, { promise: operation, signal, targets });
  return operation;
}

async function prepareLocalTargets(
  targets: EditWriteTarget[],
  feedback: AppFeedback,
  excludeTargetKey?: string,
  requestId: string = crypto.randomUUID(),
  isActive: () => boolean = () => true,
): Promise<PreparedParticipants | null> {
  if (!isActive()) return null;
  const receipts: WriteResult<unknown>[] = [];
  const commands = useSaveCommandStore();
  const participants = commands.participantsForTargets(targets).filter((handle) => handle.targetKey.value !== excludeTargetKey);
  const expectedKeys = new Map(participants.map((handle) => [handle, handle.targetKey.value]));
  for (const handle of participants) {
    if (handle.saving.value || handle.pendingSynchronization?.value) {
      if (!(await handle.waitForSave())) return null;
    }
    if (!isActive() || !commands.isSessionRegistered(handle)) return null;
    const expected = handle.targetKey.value;
    if ((await handle.editing!.draftSession.inputs.commit()) === false || handle.targetKey.value !== expected) return null;
  }
  const dirty = participants.filter((handle) => handle.editing!.dirty.value);
  if (dirty.length > 0) {
    const choice = await feedback.choose({
      title: '保存相关编辑',
      content: '以下编辑面包含相关文件的未保存修改：' + dirty.map((handle) => handle.editing!.label).join('、') + '。保存后继续交接？',
      choices: [{ label: '保存并继续', value: 'save', type: 'primary' }],
    });
    if (!isActive() || choice !== 'save') return null;
  }
  for (const handle of dirty) {
    const expected = handle.targetKey.value;
    if (!isActive() || !commands.isSessionRegistered(handle) || expected !== expectedKeys.get(handle)) return null;
    const saved = await commands.savePreparedParticipant(handle, excludeTargetKey);
    if (
      saved.status === 'cancelled' ||
      (handle.targetKey.value !== expected && (saved.status !== 'saved' || !saved.receipt.identityChanges.length))
    )
      return null;
    expectedKeys.set(handle, handle.targetKey.value);
    if (saved.status === 'saved') receipts.push(saved.receipt);
    if (handle.editing!.dirty.value)
      throw new AppError('相关编辑面在保存期间继续编辑，请完成编辑后重试', { action: 'prepare-edit-targets', code: 'joint.new_edits' });
  }
  const isCurrent = () =>
    isActive() &&
    participants.every(
      (handle) =>
        commands.isSessionRegistered(handle) && handle.targetKey.value === expectedKeys.get(handle) && !handle.editing!.dirty.value,
    );
  if (!isCurrent()) return null;
  return { receipts, release: commands.holdParticipants(participants, requestId), isCurrent };
}

async function runHandoff<T>(
  targets: EditWriteTarget[],
  feedback: AppFeedback,
  action: (receipts: WriteResult<unknown>[]) => Promise<T>,
  excludeTargetKey?: string,
  deferRelease?: (release: () => Promise<void>) => void,
  signal?: AbortSignal,
): Promise<T | null> {
  const ownerLabel = currentWindowLabel();
  const prepared = await prepareLocalTargets(targets, feedback, excludeTargetKey, undefined, () => !signal?.aborted);
  if (prepared === null) return null;
  const receipts = [...prepared.receipts];
  const remote: EditHandoffRequest[] = [];
  const release = async () => {
    prepared.release();
    try {
      for (const request of remote)
        await emitWindowEvent(WINDOW_EVENTS.editTargetRelease, {
          requestId: request.requestId,
          ownerLabel,
          receiverLabel: request.receiverLabel,
        } satisfies EditHandoffRelease);
    } finally {
      await releaseNativeWindowTargets();
    }
  };
  let retained = false;
  try {
    if (signal?.aborted) return null;
    const owners = await queryEditTargetOwners(targets);
    for (const receiverLabel of owners.filter((label) => label !== ownerLabel)) {
      const request: EditHandoffRequest = { requestId: crypto.randomUUID(), ownerLabel, receiverLabel, targets: deepClone(targets) };
      remote.push(request);
      const result = await requestRemotePreparation(request, signal);
      if (result.status === 'cancelled') return null;
      if (result.status === 'ready') receipts.push(...result.receipts);
      if (result.status === 'failed') {
        await focusEditTargetOwner(receiverLabel);
        throw new AppError(result.diagnostic.message, { action: 'prepare-edit-targets', cause: result.diagnostic });
      }
    }
    if (!prepared.isCurrent()) throw new AppError('交接期间目标或草稿已变化', { action: 'prepare-edit-targets', code: 'joint.new_edits' });
    if (signal?.aborted) return null;
    await reserveEditTargets(targets);
    const result = await action(receipts);
    if (result !== null && deferRelease) {
      deferRelease(release);
      retained = true;
    }
    return result;
  } finally {
    if (!retained) await release();
  }
}

async function requestRemotePreparation(request: EditHandoffRequest, signal?: AbortSignal): Promise<EditHandoffReply> {
  let resolve!: (reply: EditHandoffReply) => void;
  const promise = new Promise<EditHandoffReply>((finish) => (resolve = finish));
  const cancel = () => resolve({ ...request, status: 'cancelled' });
  signal?.addEventListener('abort', cancel, { once: true });
  const stop = await listenWindowEvent<EditHandoffReply>(
    WINDOW_EVENTS.editTargetPrepared,
    (reply) => {
      if (
        reply.requestId === request.requestId &&
        reply.ownerLabel === request.ownerLabel &&
        reply.receiverLabel === request.receiverLabel &&
        stableDeepEqual(reply.targets, request.targets)
      )
        resolve(reply);
    },
    recordWindowEventHandlerError,
  );
  const stopReleased = await listenWindowEvent<{ label: string }>(
    WINDOW_EVENTS.managedWindowReleased,
    ({ label }) => {
      if (label === request.receiverLabel || label === request.ownerLabel) resolve({ ...request, status: 'cancelled' });
    },
    recordWindowEventHandlerError,
  );
  try {
    if (signal?.aborted) return { ...request, status: 'cancelled' };
    await emitWindowEvent(WINDOW_EVENTS.editTargetPrepare, request);
    return await promise;
  } finally {
    stop();
    stopReleased();
    signal?.removeEventListener('abort', cancel);
  }
}

export async function listenEditTargetHandoff(feedback: AppFeedback): Promise<() => void> {
  const receiverLabel = currentWindowLabel();
  const requests = new Map<
    string,
    { request: EditHandoffRequest; promise: Promise<EditHandoffReply>; prepared: PreparedParticipants | null }
  >();
  let disposed = false;
  const stop = await listenWindowEvent<EditHandoffRequest>(
    WINDOW_EVENTS.editTargetPrepare,
    async (request) => {
      if (request.receiverLabel !== receiverLabel || disposed) return;
      if (
        [...activeHandoffs.values()].some(
          (active) =>
            !active.signal?.aborted && active.targets.some((own) => request.targets.some((target) => editTargetsOverlap(own, target))),
        )
      ) {
        await emitWindowEvent(WINDOW_EVENTS.editTargetPrepared, {
          ...request,
          status: 'failed',
          diagnostic: errorDiagnosticOf(
            new AppError('相关目标正在发起交接，请等待该动作结束后重试', { action: 'prepare-edit-targets', code: 'joint.handoff_busy' }),
          ),
        } satisfies EditHandoffReply);
        return;
      }
      let active = requests.get(request.requestId);
      if (!active) {
        const promise = Promise.resolve()
          .then(() =>
            prepareLocalTargets(
              request.targets,
              feedback,
              undefined,
              request.requestId,
              () => !disposed && requests.has(request.requestId),
            ),
          )
          .then((prepared) => {
            const active = requests.get(request.requestId);
            if (!active || disposed) {
              prepared?.release();
              return { ...request, status: 'cancelled' } as EditHandoffReply;
            }
            active.prepared = prepared;
            return prepared === null
              ? ({ ...request, status: 'cancelled' } as EditHandoffReply)
              : ({ ...request, status: 'ready', receipts: prepared.receipts } as EditHandoffReply);
          })
          .catch((error) => ({ ...request, status: 'failed', diagnostic: errorDiagnosticOf(error) }) as EditHandoffReply);
        active = { request, promise, prepared: null };
        requests.set(request.requestId, active);
      }
      const reply = await active.promise;
      if (!disposed && requests.has(request.requestId)) await emitWindowEvent(WINDOW_EVENTS.editTargetPrepared, reply);
      if (reply.status !== 'ready') {
        active.prepared?.release();
        requests.delete(request.requestId);
      }
    },
    recordWindowEventHandlerError,
  );
  const stopRelease = await listenWindowEvent<EditHandoffRelease>(
    WINDOW_EVENTS.editTargetRelease,
    (event) => {
      const active = requests.get(event.requestId);
      if (active && active.request.ownerLabel === event.ownerLabel && active.request.receiverLabel === event.receiverLabel) {
        active.prepared?.release();
        requests.delete(event.requestId);
      }
    },
    recordWindowEventHandlerError,
  );
  const stopDestroyed = await listenWindowEvent<{ label: string }>(
    WINDOW_EVENTS.managedWindowReleased,
    ({ label }) => {
      for (const [id, active] of requests)
        if (active.request.ownerLabel === label) {
          active.prepared?.release();
          requests.delete(id);
        }
    },
    recordWindowEventHandlerError,
  );
  return () => {
    disposed = true;
    stop();
    stopRelease();
    stopDestroyed();
    for (const { request, prepared } of requests.values()) {
      prepared?.release();
      void emitWindowEvent(WINDOW_EVENTS.editTargetPrepared, { ...request, status: 'cancelled' } satisfies EditHandoffReply).catch(
        (error) => recordWindowEventHandlerError(error, WINDOW_EVENTS.editTargetPrepared),
      );
    }
    requests.clear();
  };
}
