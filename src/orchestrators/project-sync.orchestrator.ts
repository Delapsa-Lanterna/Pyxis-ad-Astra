import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectSyncStore, type PendingWriteSync } from '@/stores/project-sync.store';
import type { SaveAcceptanceTask } from '@/shared/types';
import { markProjectionReady, acceptReferenceRevision, setReferenceReadiness } from '@/services/project-projection.service';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import type { InvalidatedResourceScope, CommittedWriteEvent, ProjectSessionInvalidationResult } from '@/shared/types';
import {
  registerSaveWindow,
  retryProjectSave,
  refreshProjectSources,
  waitProjectSaves,
  unregisterSaveWindow,
  resolveSaveSources,
  abandonProjectSaves,
  setReferenceSources,
} from '@/services/project-sync.service';
import { managedWindowContext } from '@/windows/window-context.window';
import type { CloseScope } from '@/shared/types';
import { pathBelongsToRoot, relativePathFromRoot, normalizeRelPath } from '@/shared/lib/paths';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { invalidateResourceMediaByProject } from '@/services/resource-media.service';

type SaveHandler = (event: CommittedWriteEvent) => ReturnType<SaveAcceptanceTask>;
interface ContentOwner {
  handler: SaveHandler;
  release?: (sessionId: string) => void;
}
interface SaveConsumers {
  feedback?: import('@/shared/types').AppFeedback;
  content: Set<ContentOwner>;
  identity: Set<SaveHandler>;
  ready: Promise<void>;
  processing: Promise<void>;
  sources: Map<string, { receive: () => SaveAcceptanceTask[]; fail: (error: unknown) => void }>;
}
const windows = new WeakMap<ReturnType<typeof useProjectSyncStore>, SaveConsumers>();
let displayReady: Promise<void> | null = null;

export async function publishReferenceSources(sources: readonly Pick<import('@/shared/types').ReferenceSource, 'sessionId' | 'modRoot'>[]) {
  await waitProjectSaves(sources.map((source) => source.modRoot));
  await setReferenceSources(sources.map((source) => source.sessionId));
}

export function pauseProjectDisplay() {
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const waiting = displayReady ? Promise.all([displayReady, paused]).then(() => {}) : paused;
  displayReady = waiting;
  void waiting.then(() => {
    if (displayReady === waiting) displayReady = null;
  });
  return async () => {
    resume();
  };
}

export function saveProjection(event: CommittedWriteEvent, sessionId: string | null | undefined) {
  const update = event.result.sessionUpdates.find((update) => update.sessionId === sessionId);
  return update?.projection ?? null;
}

function consumers() {
  const sync = useProjectSyncStore();
  let window = windows.get(sync);
  if (window) return window;
  const content = new Set<ContentOwner>(),
    identity = new Set<SaveHandler>();
  window = { content, identity, ready: Promise.resolve(), processing: Promise.resolve(), sources: new Map() };
  windows.set(sync, window);
  const registration = window;
  registration.ready = registerSaveWindow((delivery) => {
    if (delivery.kind === 'references') {
      if (!acceptReferenceRevision(delivery.snapshot.revision) || !delivery.event) return;
      delivery = { kind: 'saved', requestId: `references:${delivery.snapshot.revision}`, event: delivery.event };
    }
    if (delivery.kind === 'missing') {
      void confirmMissingSources(registration, delivery).catch((error) => recordWindowEventHandlerError(error, 'save-confirmation'));
      return;
    }
    if (delivery.kind === 'waiting') {
      sync.setWaiting(delivery.modRoot, delivery.waiting);
      return;
    }
    if (delivery.kind === 'blocked') {
      sync.setBlocked(delivery);
      return;
    }
    const event = delivery.event;
    event.result.requestId = delivery.requestId;
    for (const previous of sync.pending) {
      if (!previous.error) continue;
      if (normalizeRelPath(previous.event.modRoot).toLowerCase() !== normalizeRelPath(event.modRoot).toLowerCase()) continue;
      const earlier = previous.event.result;
      event.result = {
        ...event.result,
        content: null,
        identityChanges: [...earlier.identityChanges, ...event.result.identityChanges],
        sessionUpdates: event.result.sessionUpdates.map((update) => ({
          ...update,
          projection: {
            ...update.projection,
            invalidation: {
              ...update.projection.invalidation,
              paths: [
                ...earlier.changes.flatMap((change) => [change.beforePath, change.afterPath]),
                ...update.projection.invalidation.paths,
              ],
              session: true,
            },
          },
        })),
      };
      previous.tasks.length = 0;
      registration.sources.delete(previous.id);
      sync.complete(previous.id);
    }
    const tasks: PendingWriteSync['tasks'] = [
      async () => {
        if (displayReady) await displayReady;
      },
    ];
    if (event.reason !== 'refresh' && event.sessionId)
      tasks.push(() => useFileHistoryStore().applySnapshot(event.modRoot, event.result.history));
    for (let index = 0; index < event.result.sessionUpdates.length; index++)
      tasks.push(async () => {
        const update = event.result.sessionUpdates[index]!;
        const current = useProjectStore().getManifest(update.modRoot);
        if (current && current.sessionId !== update.sessionId) return;
        markProjectionReady(update.sessionId);
        acceptProjection(update.projection);
      });
    const source = registration.sources.get(delivery.requestId);
    if (source) tasks.push(...source.receive());
    for (const handler of identity)
      tasks.push(async () => {
        if (identity.has(handler)) return handler(event);
      });
    function ownedTask(owner: ContentOwner, task: SaveAcceptanceTask): SaveAcceptanceTask {
      return async () => {
        if (!content.has(owner)) return;
        const result = await task();
        return Array.isArray(result) ? result.map((task) => ownedTask(owner, task)) : result;
      };
    }
    for (const owner of content) tasks.push(ownedTask(owner, () => owner.handler(event)));
    const entry: PendingWriteSync = {
      id: delivery.requestId,
      event,
      tasks,
      running: null,
      error: null,
    };
    void consume(sync.receive(entry)).catch((error) => recordWindowEventHandlerError(error, 'save-delivery'));
  });
  setReferenceReadiness(registration.ready);
  return registration;
}

async function consume(entry: PendingWriteSync): Promise<void> {
  if (entry.running) return entry.running;
  const sync = useProjectSyncStore();
  entry.error = null;
  // Only unfinished work remains in this list. A successful callback immediately relinquishes its position.
  const window = consumers();
  const operation = window.processing.then(async () => {
    try {
      while (entry.tasks.length) {
        if (windows.get(sync) !== window) return;
        const next = await entry.tasks[0]!();
        entry.tasks.shift();
        if (Array.isArray(next)) entry.tasks.unshift(...next);
      }
      if (windows.get(sync) !== window) return;
      window.sources.delete(entry.id);
      sync.complete(entry.id);
    } catch (error) {
      entry.error = errorDiagnosticOf(error);
      throw error;
    } finally {
      entry.running = null;
    }
  });
  // A failed project retains its own task; the window remains available to the next project's event.
  window.processing = operation.then(
    () => undefined,
    () => undefined,
  );
  entry.running = operation;
  return operation;
}

async function confirmMissingSources(window: SaveConsumers, delivery: Extract<import('@/shared/types').SaveDelivery, { kind: 'missing' }>) {
  const choice = await window.feedback?.choose({
    title: '确认重建缺失文件',
    content: ['以下文件已缺失，将使用已读取的完整内容及本次保存修改重新创建：', ...delivery.paths].join('\n'),
    choices: [{ label: '重新创建并保存', value: 'recreate', type: 'warning' }],
  });
  await resolveSaveSources(delivery.requestId, delivery.paths, choice === 'recreate');
}

export async function startProjectSync(feedback?: import('@/shared/types').AppFeedback) {
  const sync = useProjectSyncStore();
  const window = consumers();
  window.feedback = feedback;
  await window.ready;
  return () => {
    windows.delete(sync);
    const ended = new AppError('保存交接窗口已释放', { code: 'write.window_destroyed' });
    for (const source of window.sources.values()) source.fail(ended);
    window.sources.clear();
    window.content.clear();
    window.identity.clear();
    sync.releaseWindow();
    void unregisterSaveWindow().catch((error) => recordWindowEventHandlerError(error, 'save-release'));
  };
}

export type SavedWriteOperation<T> = import('@/shared/runtime/command.runtime').SaveOperation<T>;

export function beginSavedWrite<T>(
  write: (request: import('@/shared/runtime/command.runtime').SaveCommandRequest) => Promise<T>,
  accept: (value: Exclude<T, void | null>) => SaveAcceptanceTask[],
): SavedWriteOperation<T> {
  const id = crypto.randomUUID();
  const window = consumers();
  const sync = useProjectSyncStore();
  let release!: (error: unknown) => void;
  const released = new Promise<never>((_, reject) => {
    release = reject;
  });
  window.sources.set(id, {
    fail: release,
    receive: () => [
      async () => {
        const value = await written;
        return value ? accept(value as Exclude<T, void | null>) : [];
      },
    ],
  });
  const written = window.ready.then(() => {
    if (windows.get(sync) !== window) throw new AppError('保存交接窗口已释放', { code: 'write.window_destroyed' });
    return write({ id });
  });
  const result = Promise.race([written, released]);
  void result.then(
    (value) => {
      if (!value) window.sources.delete(id);
    },
    () => {
      window.sources.delete(id);
    },
  );
  return { id, result };
}

export async function settleProjectSaves(scope: CloseScope, feedback?: import('@/shared/types').AppFeedback) {
  const roots =
    scope.kind === 'window'
      ? [managedWindowContext.value?.identity.modRoot].filter((root): root is string => !!root)
      : [...useProjectStore().manifests.values()]
          .filter((manifest) => scope.kind === 'application' || scope.sessionIds.includes(manifest.sessionId))
          .map((manifest) => manifest.modRoot);
  if (!roots.length) return;
  try {
    await waitProjectSaves(roots);
  } catch (error) {
    if (!feedback) throw error;
    const pending = useProjectSyncStore().blocked.filter((work) =>
      roots.some((root) => normalizeRelPath(root).toLowerCase() === normalizeRelPath(work.modRoot).toLowerCase()),
    );
    const choice = await feedback.choose({
      title: '保存恢复尚未完成',
      content: ['以下保存步骤尚未恢复，放弃后将保留磁盘当前内容：', ...pending.map((work) => work.diagnostic.message)].join('\n'),
      choices: [{ label: '放弃恢复并继续关闭', value: 'abandon', type: 'warning' }],
    });
    if (choice !== 'abandon') throw error;
    await abandonProjectSaves(roots);
    await waitProjectSaves(roots);
  }
}

export function observeSavedContent(handler: SaveHandler, release?: ContentOwner['release']) {
  const window = consumers();
  const owner = { handler, release };
  window.content.add(owner);
  void window.ready.catch((error) => recordWindowEventHandlerError(error, 'save-registration'));
  return () => {
    window.content.delete(owner);
  };
}

export async function listenSavedContent(handler: SaveHandler, release?: ContentOwner['release']) {
  const stop = observeSavedContent(handler, release);
  await consumers().ready;
  return stop;
}

export async function listenSavedIdentity(handler: SaveHandler) {
  const window = consumers();
  const receive: SaveHandler = (event) => {
    if (
      event.sessionId &&
      event.result.identityChanges.some(
        (change) => change.before.id !== change.after.id || change.before.write.path !== change.after.write.path,
      )
    )
      return handler(event);
  };
  window.identity.add(receive);
  await window.ready;
  return () => {
    window.identity.delete(receive);
  };
}

export function releaseProjectSession(sessionId: string) {
  const window = windows.get(useProjectSyncStore());
  const errors: unknown[] = [];
  for (const owner of window?.content ?? []) {
    try {
      owner.release?.(sessionId);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Project content release failed');
}

export function retryPendingSessionSyncs(sessionId: string) {
  return retryRequests(useProjectSyncStore().blocked.filter((work) => work.sessionId === sessionId || work.sessionIds.includes(sessionId)));
}

export function retryPendingWrites() {
  return retryRequests(useProjectSyncStore().blocked);
}

async function retryRequests(requests: ReadonlyArray<{ requestId: string; modRoot: string }>): Promise<void> {
  const sync = useProjectSyncStore();
  for (const work of requests) {
    const content = sync.pending.find((entry) => entry.id === work.requestId);
    if (content) await consume(content);
    else {
      await retryProjectSave(work.requestId);
      await waitProjectSaves([work.modRoot]);
    }
  }
}

function acceptProjection(projection: ProjectSessionInvalidationResult) {
  useProjectStore().replaceProjectManifest(projection.manifest);
  invalidateResourceMediaByProject(projection.manifest.sessionId, projection.invalidation);
  invalidateQueryCacheByProject(projection.manifest.sessionId, projection.invalidation);
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
  await consumers().ready;
  const result = await refreshProjectSources(sessionId, [
    ...new Map([...sources, ...resources].map((source) => [JSON.stringify(source), source])).values(),
  ]);
  void result;
}
