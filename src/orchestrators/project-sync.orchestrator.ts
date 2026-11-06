import { dialogBody, dialogGroup, dialogFiles } from '@/shared/ui/dialog-content';
import { debugLog, infoLog } from '@/shared/runtime/app-log-queue';
import { logIdentity } from '@/shared/lib/log-fields';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectSyncStore, type PendingWriteSync, type PendingContentSync } from '@/stores/project-sync.store';
import type { SaveAcceptanceTask, AppFeedback, ReferenceSource, ProjectSyncDelivery } from '@/shared/types';
import { markSessionReady, acceptReferenceRevision, setReferenceReadiness } from '@/services/project-readiness.service';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import type { InvalidatedResourceScope, CommittedWriteEvent, SessionContentUpdate } from '@/shared/types';
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
import type { SaveTask, SaveCommandRequest } from '@/shared/runtime/command.runtime';

type SaveHandler = (event: CommittedWriteEvent) => ReturnType<SaveAcceptanceTask>;
type CoreHandler = (root: string, sources: readonly InvalidatedResourceScope[]) => ReturnType<SaveAcceptanceTask>;
interface SavedContentHandler {
  handler: SaveHandler;
  release?: (sessionId: string) => void;
}
interface SaveConsumers {
  core: Set<CoreHandler>;
  feedback?: AppFeedback;
  content: Set<SavedContentHandler>;
  identity: Set<SaveHandler>;
  ready: Promise<void>;
  processing: Promise<void>;
  sources: Map<string, { receive: () => SaveAcceptanceTask[]; fail: (error: unknown) => void }>;
}
const windows = new WeakMap<ReturnType<typeof useProjectSyncStore>, SaveConsumers>();
let displayReady: Promise<void> | null = null;

export async function publishReferenceSources(
  sources: readonly Pick<ReferenceSource, 'sessionId' | 'modRoot'>[],
  order = sources.map((source) => source.sessionId),
) {
  await waitProjectSaves(sources.map((source) => source.modRoot));
  await setReferenceSources(
    sources.map((source) => source.sessionId),
    order,
  );
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

export function sessionContentUpdate(event: CommittedWriteEvent, sessionId: string | null | undefined) {
  const update = event.result.sessionUpdates.find((update) => update.sessionId === sessionId);
  return update?.content ?? null;
}

function consumers() {
  const sync = useProjectSyncStore();
  let window = windows.get(sync);
  if (window) return window;
  const content = new Set<SavedContentHandler>(),
    identity = new Set<SaveHandler>();
  window = { core: new Set(), content, identity, ready: Promise.resolve(), processing: Promise.resolve(), sources: new Map() };
  windows.set(sync, window);
  const registration = window;
  registration.ready = registerSaveWindow((delivery) => {
    if (delivery.kind === 'coreChanged') {
      const changed = delivery;
      const entry = sync.receive({
        id: crypto.randomUUID(),
        event: null,
        modRoot: changed.root,
        sessionId: null,
        tasks: [...registration.core].map((receive) => async () => {
          if (!registration.core.has(receive)) return;
          const tasks = await receive(changed.root, changed.sources);
          if (!Array.isArray(tasks)) return;
          let unfinished = tasks;
          return [
            async () => {
              if (!registration.core.has(receive)) return;
              const results = await Promise.allSettled(unfinished.map((task) => task()));
              unfinished = unfinished.filter((_, index) => results[index]!.status === 'rejected');
              const failures = results.filter((result) => result.status === 'rejected');
              if (failures.length)
                throw new AggregateError(
                  failures.map((result) => result.reason),
                  'Core content acceptance failed',
                );
            },
          ];
        }),
        running: null,
        error: null,
      });
      void consume(entry).catch((error) => recordWindowEventHandlerError(error, 'core-refresh'));
      return;
    }
    if (delivery.kind === 'sourceStatus') {
      sync.setSourceStatus(delivery);
      return;
    }
    if (delivery.kind === 'references') {
      if (!acceptReferenceRevision(delivery.snapshot.revision) || !delivery.event) return;
      delivery = { kind: 'saved', requestId: `references:${delivery.snapshot.revision}`, event: delivery.event };
    }
    if (delivery.kind === 'missing') {
      void confirmMissingSources(registration, delivery).catch((error) => recordWindowEventHandlerError(error, 'save-confirmation'));
      return;
    }
    if (delivery.kind === 'waiting') {
      debugLog('save.waiting', () => logIdentity(delivery));
      sync.setWaiting(delivery.modRoot, delivery.waiting);
      return;
    }
    if (delivery.kind === 'blocked') {
      debugLog('save.blocked', () => ({
        ...logIdentity(delivery),
        errorCode: delivery.diagnostic.code,
        error: delivery.diagnostic.message,
      }));
      sync.setBlocked(delivery);
      return;
    }
    const event = delivery.event;
    event.result.requestId = delivery.requestId;
    debugLog('save.delivered', () => ({
      requestId: delivery.requestId,
      reason: event.reason,
      modRoot: event.modRoot,
      sessionId: event.sessionId ?? '',
      changes: String(event.result.changes.length),
    }));
    for (const previous of sync.pending) {
      if (!previous.event) continue;
      if (!previous.error) continue;
      if (normalizeRelPath(previous.event.modRoot).toLowerCase() !== normalizeRelPath(event.modRoot).toLowerCase()) continue;
      const earlier = previous.event.result;
      event.result = {
        ...event.result,
        content: null,
        identityChanges: [...earlier.identityChanges, ...event.result.identityChanges],
        sessionUpdates: event.result.sessionUpdates.map((update) => ({
          ...update,
          content: {
            ...update.content,
            invalidation: {
              ...update.content.invalidation,
              paths: [...earlier.changes.flatMap((change) => [change.beforePath, change.afterPath]), ...update.content.invalidation.paths],
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
        markSessionReady(update.sessionId);
        acceptContentUpdate(update.content);
      });
    const source = registration.sources.get(delivery.requestId);
    if (source) tasks.push(...source.receive());
    for (const handler of identity)
      tasks.push(async () => {
        if (identity.has(handler)) return handler(event);
      });
    function ownedTask(owner: SavedContentHandler, task: SaveAcceptanceTask): SaveAcceptanceTask {
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

async function consume(entry: PendingContentSync): Promise<void> {
  if (entry.running) return entry.running;
  const sync = useProjectSyncStore();
  entry.error = null;
  // Only unfinished task remains in this list. A successful callback immediately relinquishes its position.
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
      debugLog('save.accepted', () => ({
        requestId: entry.id,
        modRoot: entry.event ? entry.event.modRoot : entry.modRoot,
        sessionId: entry.event?.sessionId ?? '',
      }));
    } catch (error) {
      entry.error = errorDiagnosticOf(error);
      debugLog('save.acceptance_failed', () => ({
        requestId: entry.id,
        modRoot: entry.event ? entry.event.modRoot : entry.modRoot,
        remaining: String(entry.tasks.length),
        errorCode: entry.error!.code,
        error: entry.error!.message,
      }));
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

async function confirmMissingSources(window: SaveConsumers, delivery: Extract<ProjectSyncDelivery, { kind: 'missing' }>) {
  const choice = await window.feedback?.choose({
    title: '重新创建文件并保存？',
    content:
      (delivery.paths.length === 1 ? '这个文件已缺失' : '以下 ' + delivery.paths.length + ' 个文件已缺失') +
      '，将使用之前读取的内容加上本次修改重新创建。\n\n' +
      delivery.paths.join('\n'),
    choices: [{ label: '重新创建并保存', value: 'recreate', type: 'warning' }],
    cancelText: '返回编辑',
  });
  for (const path of delivery.paths)
    infoLog('save.source_rebuild_decided', () => ({
      requestId: delivery.requestId,
      path,
      status: choice === 'recreate' ? 'confirmed' : 'cancelled',
    }));
  await resolveSaveSources(delivery.requestId, delivery.paths, choice === 'recreate');
}

export async function startProjectSync(feedback?: AppFeedback) {
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

export function beginSavedWrite<T>(
  write: (request: SaveCommandRequest) => Promise<T>,
  accept: (value: Exclude<T, void | null>) => SaveAcceptanceTask[],
): SaveTask<T> {
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

export async function settleProjectSaves(scope: CloseScope, feedback?: AppFeedback) {
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
    const pending = useProjectSyncStore().blocked.filter((task) =>
      roots.some((root) => normalizeRelPath(root).toLowerCase() === normalizeRelPath(task.modRoot).toLowerCase()),
    );
    const choice = await feedback.choose({
      title: '结束保存恢复并关闭？',
      content: () =>
        dialogBody(
          '以下 ' + pending.length + ' 个保存任务仍有步骤需要恢复。继续关闭将结束这些恢复任务，并保留磁盘当前内容。',
          ...pending.map((task) =>
            dialogGroup(
              task.modRoot,
              task.diagnostic.message,
              ...(task.diagnostic.location?.path ? ['涉及文件：', dialogFiles([task.diagnostic.location.path])] : []),
              '请求：' + task.requestId,
            ),
          ),
        ),
      choices: [{ label: '结束恢复并关闭', value: 'abandon', type: 'warning' }],
      cancelText: '返回处理',
    });
    for (const task of pending)
      infoLog('save.recovery_decided', () => ({
        requestId: task.requestId,
        modRoot: task.modRoot,
        status: choice === 'abandon' ? 'abandoned' : 'retained',
      }));
    if (choice !== 'abandon') throw error;
    await abandonProjectSaves(roots);
    await waitProjectSaves(roots);
  }
}

export function observeSavedContent(handler: SaveHandler, release?: SavedContentHandler['release']) {
  const window = consumers();
  const owner = { handler, release };
  window.content.add(owner);
  void window.ready.catch((error) => recordWindowEventHandlerError(error, 'save-registration'));
  return () => {
    window.content.delete(owner);
  };
}

export async function listenSavedContent(handler: SaveHandler, release?: SavedContentHandler['release']) {
  const stop = observeSavedContent(handler, release);
  await consumers().ready;
  return stop;
}
export function observeCoreContent(handler: CoreHandler) {
  const window = consumers();
  window.core.add(handler);
  return {
    ready: window.ready,
    release: () => {
      window.core.delete(handler);
    },
  };
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

export function releaseProjectContentConsumers(sessionId: string) {
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
  return retryRequests(useProjectSyncStore().blocked.filter((task) => task.sessionId === sessionId || task.sessionIds.includes(sessionId)));
}

export function retryPendingWrites() {
  return retryRequests(useProjectSyncStore().blocked);
}

async function retryRequests(requests: ReadonlyArray<{ requestId: string; modRoot: string }>): Promise<void> {
  const sync = useProjectSyncStore();
  for (const task of requests) {
    const content = sync.pending.find((entry) => entry.id === task.requestId);
    infoLog('save.retry_started', () => ({ requestId: task.requestId, modRoot: task.modRoot, phase: content ? 'content' : 'native' }));
    if (content) await consume(content);
    else {
      await retryProjectSave(task.requestId);
      await waitProjectSaves([task.modRoot]);
    }
    infoLog('save.retry_completed', () => ({ requestId: task.requestId, modRoot: task.modRoot, phase: content ? 'content' : 'native' }));
  }
}

function acceptContentUpdate(update: SessionContentUpdate) {
  useProjectStore().replaceProjectManifest(update.manifest);
  invalidateResourceMediaByProject(update.manifest.sessionId, update.invalidation);
  invalidateQueryCacheByProject(update.manifest.sessionId, update.invalidation);
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
