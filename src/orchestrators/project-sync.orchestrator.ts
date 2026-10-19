import {
  WINDOW_EVENTS,
  type CommittedWriteEvent,
  type ProjectSessionInvalidatedEvent,
  type EntityIdentityAppliedEvent,
} from '@/windows/window.events';
import { emitWindowEvent, listenWindowEvent, type WindowEventHandler } from '@/windows/tauri.events';
import { currentWindowLabel } from '@/windows/current.window';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectSyncStore, type PendingWriteSync } from '@/stores/project-sync.store';
import { markProjectionPending, markProjectionReady } from '@/services/project-projection.service';
import { AppError, errorDiagnosticOf, withCause, errorMessageOf } from '@/shared/lib/errors';
import { recordLogBestEffort } from '@/services/app-log.service';
import type { WriteResult, InvalidatedResourceScope } from '@/shared/types';
import { refreshProjectSources, synchronizeSessionCommit } from '@/services/project-sync.service';
import { pathBelongsToRoot, relativePathFromRoot, normalizeRelPath } from '@/shared/lib/paths';
import { invalidateQueryCacheByProject, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { invalidateResourceMediaByProject } from '@/services/resource-media.service';

let displayPaused = false;
const displayUpdates: Array<() => Promise<unknown>> = [];
export function pauseProjectDisplay() {
  displayPaused = true;
  return async () => {
    displayPaused = false;
    for (const update of displayUpdates.splice(0)) await update();
  };
}
async function deliverDisplay(action: () => Promise<unknown> | unknown) {
  if (displayPaused) {
    displayUpdates.push(async () => action());
    return;
  }
  await action();
}
const syncExecutions = new WeakMap<ReturnType<typeof useProjectSyncStore>, Map<string, Promise<void>>>();

function acceptCommittedWrite(event: CommittedWriteEvent) {
  const project = useProjectStore();
  const sync = useProjectSyncStore();
  if (sync.wasAccepted(event)) return;
  const current = project.getManifest(event.modRoot);
  if (current && event.sessionId && current.sessionId !== event.sessionId) return;
  if (event.sessionId) useFileHistoryStore().applySnapshot(event.modRoot, event.result.history);
  for (const update of event.result.sessionUpdates) {
    if (update.status !== 'ready') continue;
    const manifest = project.getManifest(update.modRoot);
    if (manifest && manifest.sessionId !== update.sessionId) continue;
    markProjectionReady(update.sessionId, update.commitId);
    acceptProjectSessionProjection(update.projection);
  }
  sync.markAccepted(event);
}

export async function publishCommittedWrite(
  modRoot: string,
  result: WriteResult<unknown>,
  sessionId: string | null,
  reason: CommittedWriteEvent['reason'] = 'save',
) {
  const event: CommittedWriteEvent = { modRoot, result, sessionId, reason, originWindowLabel: currentWindowLabel() };
  const sync = useProjectSyncStore();
  if (
    sync.wasAccepted(event) &&
    !sync.pending.some((entry) => entry.event.modRoot === modRoot && entry.event.result.commitId === result.commitId)
  )
    return;
  const entry = sync.enqueue(event);
  await synchronizeEntry(entry);
}

async function synchronizeEntry(entry: PendingWriteSync): Promise<void> {
  const sync = useProjectSyncStore();
  if (!syncExecutions.has(sync)) syncExecutions.set(sync, new Map());
  const running = syncExecutions.get(sync)!.get(entry.id);
  if (running) return running;
  const operation = executeSync(entry)
    .catch((error) => {
      sync.markFailed(entry.id, errorDiagnosticOf(error));
      throw error;
    })
    .finally(() => syncExecutions.get(sync)!.delete(entry.id));
  syncExecutions.get(sync)!.set(entry.id, operation);
  return operation;
}

async function executeSync(entry: PendingWriteSync) {
  const sync = useProjectSyncStore();
  const current = useProjectStore().getManifest(entry.event.modRoot);
  if (current && entry.event.sessionId && current.sessionId !== entry.event.sessionId) {
    sync.complete(entry.id);
    return;
  }
  entry.error = null;
  if (!entry.historyAccepted) {
    if (entry.event.sessionId) useFileHistoryStore().applySnapshot(entry.event.modRoot, entry.event.result.history);
    entry.historyAccepted = true;
  }
  if (entry.step === 'projection') {
    for (let index = 0; index < entry.event.result.sessionUpdates.length; index++) {
      const update = entry.event.result.sessionUpdates[index]!;
      if (update.status === 'pending') {
        markProjectionPending(update.sessionId, update.commitId);
        const restored = await synchronizeSessionCommit(update.sessionId, update.modRoot, update.commitId);
        if (restored.status === 'pending')
          throw new AppError(restored.error.message, {
            action: 'synchronize-committed-write',
            code: restored.error.code,
            location: restored.error.location,
          });
        entry.event.result.sessionUpdates[index] = restored;
      }
    }
    entry.step = 'acceptance';
  }
  if (!sync.pending.some((candidate) => candidate.id === entry.id)) return;
  if (entry.step === 'acceptance') {
    acceptCommittedWrite(entry.event);
    entry.step = 'broadcast';
  }
  if (entry.event.result.changes.length > 0) await emitWindowEvent(WINDOW_EVENTS.committedWriteApplied, entry.event);
  sync.complete(entry.id);
}

export async function retryPendingSessionSyncs(sessionId: string) {
  const sync = useProjectSyncStore();
  for (const entry of [...sync.pending]) {
    if (entry.event.sessionId === sessionId || entry.event.result.sessionUpdates.some((update) => update.sessionId === sessionId))
      await synchronizeEntry(entry);
  }
}

export function retryPendingModSyncs(modRoot: string): Promise<void> | undefined {
  const sync = useProjectSyncStore();
  const entries = sync.pending.filter((entry) => entry.event.modRoot === modRoot);
  if (entries.length === 0) return;
  return (async () => {
    for (const entry of entries) await synchronizeEntry(entry);
  })();
}

interface CommitSubscriber {
  handler: WindowEventHandler<CommittedWriteEvent>;
  matches: (event: CommittedWriteEvent) => boolean;
  phase: 'identity' | 'projection';
  delivered: Set<string>;
}
interface CommitListeners {
  subscribers: Set<CommitSubscriber>;
  registration: Promise<() => void>;
}
const commitListeners = new WeakMap<ReturnType<typeof useProjectSyncStore>, CommitListeners>();

export async function listenCommittedWrites(
  handler: WindowEventHandler<CommittedWriteEvent>,
  matches: (event: CommittedWriteEvent) => boolean = () => true,
  phase: CommitSubscriber['phase'] = 'projection',
) {
  const sync = useProjectSyncStore();
  let listeners = commitListeners.get(sync);
  if (!listeners) {
    const subscribers = new Set<CommitSubscriber>();
    const dispatches = new Map<string, Promise<void>>();
    async function deliver(event: CommittedWriteEvent, key: string) {
      if (event.originWindowLabel === currentWindowLabel()) return;
      const current = useProjectStore().getManifest(event.modRoot);
      if (current && event.sessionId && current.sessionId !== event.sessionId) return;
      const selected = [...subscribers].filter((subscriber) => subscriber.matches(event) && !subscriber.delivered.has(key));
      const identities = selected
        .filter((subscriber) => subscriber.phase === 'identity')
        .map((subscriber) => {
          const operation = Promise.resolve().then(() => {
            if (subscribers.has(subscriber))
              return deliverDisplay(() => (subscribers.has(subscriber) ? subscriber.handler(event) : undefined));
          });
          return operation.then(() => subscriber.delivered.add(key));
        });
      acceptCommittedWrite(event);
      await Promise.all(identities);
      const latest = useProjectStore().getManifest(event.modRoot);
      if (latest && event.sessionId && latest.sessionId !== event.sessionId) return;
      for (const subscriber of selected.filter((subscriber) => subscriber.phase === 'projection')) {
        if (!subscribers.has(subscriber)) continue;
        await deliverDisplay(() => (subscribers.has(subscriber) ? subscriber.handler(event) : undefined));
        subscriber.delivered.add(key);
      }
    }
    const registration = listenWindowEvent<CommittedWriteEvent>(
      WINDOW_EVENTS.committedWriteApplied,
      (event) => {
        const key = JSON.stringify([event.sessionId, event.modRoot, event.result.commitId]);
        const running = dispatches.get(key);
        if (running) return running;
        const operation = deliver(event, key).finally(() => dispatches.delete(key));
        dispatches.set(key, operation);
        return operation;
      },
      recordWindowEventHandlerError,
    );
    listeners = { subscribers, registration };
    commitListeners.set(sync, listeners);
  }
  const subscriber: CommitSubscriber = { handler, matches, phase, delivered: new Set() };
  listeners.subscribers.add(subscriber);
  let stop: () => void;
  try {
    stop = await listeners.registration;
  } catch (error) {
    listeners.subscribers.delete(subscriber);
    commitListeners.delete(sync);
    throw error;
  }
  const registration = listeners;
  return () => {
    registration.subscribers.delete(subscriber);
    if (registration.subscribers.size === 0) {
      stop();
      commitListeners.delete(sync);
    }
  };
}

export interface SavedWriteCompletion {
  label: string;
  modRoot: string;
  result: WriteResult<unknown>;
  sessionId: string;
}
export async function completeSavedWrite(completion: SavedWriteCompletion): Promise<void> {
  try {
    await publishCommittedWrite(completion.modRoot, completion.result, completion.sessionId);
  } catch (error) {
    recordLogBestEffort({
      level: 'warning',
      code: 'write.sync_pending',
      message: errorMessageOf(error),
      path: completion.modRoot,
      line: null,
      fields: { sessionId: completion.sessionId },
    });
    throw withCause('已写盘，项目同步失败', error, 'sync-saved-write');
  }
}

export function invalidateProjectionCaches(event: ProjectSessionInvalidatedEvent) {
  const sync = useProjectSyncStore();
  if (sync.wereProjectionCachesInvalidated(event.manifest.sessionId, event.projectionRevision)) return;
  invalidateResourceMediaByProject(event.manifest.sessionId, event.invalidation);
  invalidateQueryCacheByProject(event.manifest.sessionId, event.invalidation);
  sync.markProjectionCachesInvalidated(event.manifest.sessionId, event.projectionRevision);
}

export async function refreshProjectSourcePaths(
  sessionId: string,
  modRoot: string,
  paths: string[],
  resources: readonly InvalidatedResourceScope[] = [],
) {
  const sources: InvalidatedResourceScope[] = paths.map((path) =>
    pathBelongsToRoot(path, modRoot)
      ? { source: 'mod', relPath: relativePathFromRoot(modRoot, path) }
      : {
          source: 'core',
          relPath: normalizeRelPath(path)
            .split(/\/starsector-core\//i)
            .at(-1)!,
        },
  );
  let active = true;
  const stop = subscribeQueryInvalidations((event) => {
    if (event.sessionId === sessionId && event.scope === 'session') active = false;
  });
  try {
    const result = await refreshProjectSources(sessionId, [
      ...new Map([...sources, ...resources].map((source) => [JSON.stringify(source), source])).values(),
    ]);
    if (!active) return;
    acceptProjectSessionProjection(result);
    await emitWindowEvent(WINDOW_EVENTS.projectSourcesRefreshed, { ...result, originWindowLabel: currentWindowLabel() });
  } catch (error) {
    if (active) throw error;
  } finally {
    stop();
  }
}
function acceptProjectSessionProjection(event: ProjectSessionInvalidatedEvent) {
  const project = useProjectStore();
  const previous = project.getManifest(event.manifest.modRoot);
  if (previous && previous.sessionId !== event.manifest.sessionId) return;
  project.replaceProjectManifest(event.manifest, event.projectionRevision);
  invalidateProjectionCaches(event);
}

export function listenEntityIdentityApplied(handler: WindowEventHandler<EntityIdentityAppliedEvent>) {
  return listenCommittedWrites(
    async (event) => {
      if (
        event.sessionId &&
        event.result.identityChanges.some(
          (change) => change.before.id !== change.after.id || change.before.write.path !== change.after.write.path,
        )
      )
        await handler({ sessionId: event.sessionId, modRoot: event.modRoot, result: event.result });
    },
    () => true,
    'identity',
  );
}

export async function listenProjectSessionInvalidated(handler: WindowEventHandler<ProjectSessionInvalidatedEvent>) {
  const stop = await listenCommittedWrites(async (event) => {
    for (const update of event.result.sessionUpdates) if (update.status === 'ready') await handler(update.projection);
  });
  try {
    const stopRefresh = await listenWindowEvent<ProjectSessionInvalidatedEvent & { originWindowLabel: string }>(
      WINDOW_EVENTS.projectSourcesRefreshed,
      async (event) => {
        if (event.originWindowLabel === currentWindowLabel()) return;
        acceptProjectSessionProjection(event);
        await deliverDisplay(() => handler(event));
      },
      recordWindowEventHandlerError,
    );
    return () => {
      stop();
      stopRefresh();
    };
  } catch (error) {
    stop();
    throw error;
  }
}
